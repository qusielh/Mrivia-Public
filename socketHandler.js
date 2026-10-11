// socketHandler.js
const cookieParser = require('cookie-parser');
const { COOKIE_SECRET, userCache, activeRooms, deletionTimeouts, generateMaskedPayload } = require('./config');
const { startRoomTimer, getModeHandler, runGameWaitingPhase, initiateUniversalGameLoop } = require('./gameCore');
const { isProfane, community_TROLL_MESSAGE } = require('./profanityFilter');

const GAME_MODE_URLS = {
    0: '/mrivia',
    1: '/pixelary',
    2: '/recipe',
    3: '/minele',
    4: '/szc',
    'classic': '/mrivia',
    'pixelary': '/pixelary',
    'recipe': '/recipe',
    'minele': '/minele',
    'szc': '/szc'
};

// 🟢 Reliable socket cookie parser that handles base64 '=' padding cleanly
function extractSignedCookies(cookieHeader) {
    if (!cookieHeader) return {};
    const rawCookies = {};
    cookieHeader.split(';').forEach(c => {
        const idx = c.indexOf('=');
        if (idx !== -1) {
            const key = c.substring(0, idx).trim();
            const val = c.substring(idx + 1).trim();
            try {
                rawCookies[key] = decodeURIComponent(val);
            } catch (e) {
                rawCookies[key] = val;
            }
        }
    });
    return cookieParser.signedCookies(rawCookies, COOKIE_SECRET);
}

// 🟢 Immediately erase empty rooms from memory to free CPU & RAM (WITH HIGH-VISIBILITY LOGGING)
function destroyEmptyRoomImmediately(roomId, reason = "Empty") {
    if (!activeRooms[roomId]) return;
    const room = activeRooms[roomId];
    if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
    }
    if (deletionTimeouts[roomId]) {
        clearTimeout(deletionTimeouts[roomId]);
        delete deletionTimeouts[roomId];
    }
    delete activeRooms[roomId];
    console.log(`🧹 [Room Purged] Room [${roomId}] (${reason}) erased from RAM.`);
}

function setupSockets(io, db) {
    // 🟢 SYNCHRONOUS HANDLER: Zero async pausing before listeners are registered
    io.on('connection', (socket) => {
        console.log(`🔌 [Socket.IO] New connection established: ${socket.id}`);

        // Background non-blocking user tag
        try {
            const signedCookies = extractSignedCookies(socket.handshake.headers.cookie);
            const rawUserId = signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;

            if (userId && !isNaN(userId)) {
                if (userCache[userId]) {
                    socket.data.username = userCache[userId];
                    socket.join("user_" + userCache[userId]);
                } else {
                    db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId])
                        .then(user => {
                            if (user && !user.is_suspended && user.username) {
                                userCache[userId] = user.username;
                                socket.data.username = user.username;
                                socket.join("user_" + user.username);
                            }
                        })
                        .catch(err => console.error("User tag error:", err));
                }
            }
        } catch (e) {
            console.error("Cookie parsing error on connect:", e);
        }

        // 🟢 SYNCHRONOUS LISTENER: MODE 4 (SZC) SUBMIT CHOICE
        socket.on('szc_submit_choice', (data) => {
            const { username, roomId } = socket.data;
            const room = activeRooms[roomId];
            if (!room || room.status !== 'started' || room.mode !== 4) return;

            const handler = getModeHandler(room.mode);
            if (handler && handler.handlePlayerChoice) {
                handler.handlePlayerChoice(socket, io, roomId, room, username, data?.choice);
            }
        });

        // 🟢 REGISTER 'join_match' IMMEDIATELY SO IT NEVER DROPS
        socket.on('join_match', async () => {
            console.log(`📥 [Socket Event] 'join_match' received from socket: ${socket.id}`);

            try {
                const signedCookies = extractSignedCookies(socket.handshake.headers.cookie);
                const rawUserId = signedCookies.mt_user_id;
                const userId = rawUserId ? Number(rawUserId) : null;
                const roomId = signedCookies.mt_room_id;

                console.log(`🍪 [Socket Session] Parsed userId: ${userId}, roomId: ${roomId}`);

                if (!userId || isNaN(userId) || !roomId) {
                    console.warn(`⚠️ [Socket Warning] join_match rejected: userId (${userId}) or roomId (${roomId}) missing from cookies.`);
                    socket.emit('redirect_to_lobby', { reason: "Security token verification failed." });
                    return;
                }

                let verifiedUsername = userCache[userId];
                if (!verifiedUsername) {
                    const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
                    if (!user || user.is_suspended || !user.username) {
                        console.warn(`⚠️ [Socket Warning] join_match rejected: user ${userId} not found in database or suspended.`);
                        socket.emit('redirect_to_lobby', { reason: "Account suspended or not found." });
                        return;
                    }
                    verifiedUsername = user.username;
                    userCache[userId] = verifiedUsername;
                }

                if (!activeRooms[roomId] || activeRooms[roomId].status === 'deleting') {
                    console.warn(`⚠️ [Socket Warning] join_match rejected: Room [${roomId}] not found in activeRooms (status: ${activeRooms[roomId]?.status}). Active rooms:`, Object.keys(activeRooms));
                    socket.emit('redirect_to_lobby', { reason: "Room expired." });
                    return;
                }

                const room = activeRooms[roomId];

                // 🟢 GUARD 1: Prevent joining if room is already full (allows reconnecting players through)
                if (room.status === 'waiting' && !room.players.includes(verifiedUsername) && room.players.length >= room.maxPlayers) {
                    console.warn(`⚠️ [Socket Warning] join_match rejected: Room [${roomId}] is full (${room.players.length}/${room.maxPlayers}).`);
                    socket.emit('redirect_to_lobby', { reason: "This room is already full!" });
                    return;
                }

                // 🟢 GUARD 2: Prevent joining if match is already in progress (allows reconnecting players through)
                if (room.status !== 'waiting' && (!room.players || !room.players.includes(verifiedUsername))) {
                    console.warn(`⚠️ [Socket Warning] join_match rejected: Room [${roomId}] match already in progress.`);
                    socket.emit('redirect_to_lobby', { reason: "This match has already started!" });
                    return;
                }

                if (deletionTimeouts[roomId]) {
                    clearTimeout(deletionTimeouts[roomId]);
                    delete deletionTimeouts[roomId];
                }

                socket.join(roomId);
                socket.data.username = verifiedUsername;
                socket.data.roomId = roomId;
                socket.join("user_" + verifiedUsername);

                if (!activeRooms[roomId].players.includes(verifiedUsername)) {
                    activeRooms[roomId].players.push(verifiedUsername);
                }

                if (room.disconnectTimeouts && room.disconnectTimeouts[verifiedUsername]) {
                    clearTimeout(room.disconnectTimeouts[verifiedUsername]);
                    delete room.disconnectTimeouts[verifiedUsername];
                }

                const wasDisconnected = room.gameScores && room.gameScores[verifiedUsername] && room.gameScores[verifiedUsername].isDisconnected;

                if (room.gameScores && room.gameScores[verifiedUsername]) {
                    room.gameScores[verifiedUsername].isDisconnected = false;
                }

                console.log(`📤 [Socket Emit] Sending room_config (Mode: ${room.mode}, MaxPlayers: ${room.maxPlayers}, isCustom: ${room.isCustom}) to ${verifiedUsername}`);
                socket.emit('room_config', {
                    mode: room.mode,
                    maxPlayers: room.maxPlayers,
                    isCustom: room.isCustom,
                    roomCode: room.isCustom ? roomId : null
                });

                // ========================================================
                // 🟢 MODE 4 (SZC) INSTANT MATCH LAUNCH (ZERO COUNTDOWN DELAY)
                // ========================================================
                if (room.mode === 4) {
                    if (room.players.length === 1) {
                        socket.emit('szc_waiting_for_opponent');
                    } else if (room.players.length === 2 && room.status === 'waiting') {
                        // 2 Players inside: Lock room and launch round 1 INSTANTLY!
                        room.status = 'started';

                        const p1 = room.players[0];
                        const p2 = room.players[1];

                        // Send opponent names to both sockets
                        const socketsInRoom = await io.in(roomId).fetchSockets();
                        socketsInRoom.forEach(s => {
                            const u = s.data?.username;
                            s.emit('szc_match_start', {
                                opponentName: (u === p1) ? p2 : p1
                            });
                        });

                        initiateUniversalGameLoop(roomId);
                    }
                    return;
                }

                if (room.status === 'game_waiting') {
                    socket.emit('game_waiting_tick', { time: room.gameWaitingClock });
                    io.to(roomId).emit('update_room_ui', { players: room.players });
                }
                else if (room.status === 'game_countdown') {
                    socket.emit('game_countdown_tick', { time: room.gameCountdownClock });
                    io.to(roomId).emit('update_room_ui', { players: room.players });
                }
                else if (room.status === 'started') {
                    const isPainter = (room.mode === 1 && verifiedUsername === room.currentPainter);

                    if (room.mode === 1) {
                        const activeList = room.initialPlayers || room.players;
                        const eligibleRemaining = activeList.filter(pName => {
                            const p = room.gameScores[pName];
                            return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
                        });
                        room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;
                    }

                    socket.emit('round_init', {
                        round: room.currentRound,
                        maxRounds: room.maxRounds,
                        maskedWord: generateMaskedPayload(room.currentWord, room.revealedPositions),
                        mode: room.mode,
                        category: room.currentCategory,
                        currentPainter: room.currentPainter,
                        isPainter: isPainter,
                        secretWord: (room.mode === 1 && isPainter) ? room.currentWord : (room.mode === 3 && isPainter) ? room.currentWord : null,
                        wordLength: room.currentWord.length,
                        totalAttempts: room.totalAttempts || 6,
                        revealedSlots: room.revealedSlots || []
                    });

                    io.to(roomId).emit('leaderboard_update', {
                        leaderboard: Object.values(room.gameScores),
                        currentRound: room.currentRound,
                        maxRounds: room.maxRounds
                    });

                    if (wasDisconnected) {
                        io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `${verifiedUsername} reconnected.`, type: 'default' });
                    }

                    if (room.matchClock !== undefined) {
                        let displayHintClock = Math.max(0, room.hintClock);
                        if (room.mode !== 0 && room.mode !== 2) displayHintClock = "--";

                        socket.emit('clock_tick', {
                            matchClock: Math.max(0, room.matchClock),
                            hintClock: displayHintClock
                        });
                    }

                    const handler = getModeHandler(room.mode);
                    if (handler.onPlayerReconnectRehydrate) {
                        handler.onPlayerReconnectRehydrate(socket, room, verifiedUsername);
                    }
                }
                else if (room.status === 'waiting') {
                    if (!room.isCustom) {
                        if (room.players.length === room.maxPlayers && room.timer > 5) {
                            room.timer = 5;
                            io.to(roomId).emit('timer_update', { time: 5 });
                        }
                        startRoomTimer(roomId);
                        socket.emit('timer_update', { time: room.timer !== undefined ? room.timer : 120 });
                    }
                    console.log(`📤 [Socket Broadcast] update_room_ui to Room [${roomId}] with players:`, room.players);
                    io.to(roomId).emit('update_room_ui', { players: room.players });
                }

                console.log(`🎮 [Socket Success] Routed "${verifiedUsername}" to Room [${roomId}] (Players: ${room.players.length}/${room.maxPlayers}, State: ${room.status})`);

            } catch (error) {
                console.error("🔴 [Socket Error] Matchmaking system exception:", error);
                socket.emit('redirect_to_lobby', { reason: "Internal matchmaking error." });
            }
        });

        // 🟢 INSTANT QUEUE EXIT: Immediately cleans empty public queues with zero delay
        socket.on('leave_queue', () => {
            const { username, roomId } = socket.data;
            if (!roomId || !activeRooms[roomId]) return;
            const room = activeRooms[roomId];

            if (room.status === 'waiting') {
                if (username) {
                    room.players = room.players.filter(name => name !== username);
                }
                console.log(`🚪 [Queue Exit] Player "${username || 'Player'}" explicitly left Room [${roomId}]. (Remaining: ${room.players.length})`);
                io.to(roomId).emit('update_room_ui', { players: room.players });

                if (room.players.length === 0) {
                    if (!room.isCustom) {
                        destroyEmptyRoomImmediately(roomId, "All players left public queue");
                    } else {
                        // 30s grace period for custom party rooms
                        deletionTimeouts[roomId] = setTimeout(() => {
                            if (activeRooms[roomId] && activeRooms[roomId].status === 'waiting' && activeRooms[roomId].players.length === 0) {
                                destroyEmptyRoomImmediately(roomId, "Custom party abandoned");
                            }
                        }, 30000);
                    }
                }
            }
        });

        socket.on('player_ready', (data) => {
            const roomId = socket.data.roomId;
            const room = activeRooms[roomId];
            if (!room || !room.isCustom || room.status !== 'waiting') return;

            if (!room.readyPlayers) room.readyPlayers = new Set();
            if (data.ready) {
                room.readyPlayers.add(socket.data.username);
            } else {
                room.readyPlayers.delete(socket.data.username);
            }

            const totalPlayers = room.players.length;
            const readyCount = room.readyPlayers.size;

            if (totalPlayers >= 2 && readyCount >= totalPlayers) {
                if (room.interval) {
                    clearInterval(room.interval);
                    room.interval = null;
                }

                room.status = 'game_waiting';
                room.gameWaitingClock = 5;

                const targetUrl = GAME_MODE_URLS[room.mode] || '/mrivia';
                io.to(roomId).emit('redirect_to_game', { url: targetUrl });
                runGameWaitingPhase(roomId);
            }
        });

        const handleExplicitLeave = async () => {
            const { username, roomId } = socket.data;
            const room = activeRooms[roomId];
            if (!room) return;

            if (room.gameScores && room.gameScores[username]) {
                room.gameScores[username].hasLeft = true;
                if (room.mode === 4) {
                    room.gameScores[username].score = 0; // Forfeiter in Mode 4 gets 0 pts
                }

                if (room.mode === 1) {
                    const activeList = room.initialPlayers || room.players;
                    const eligibleRemaining = activeList.filter(pName => {
                        const p = room.gameScores[pName];
                        return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
                    });
                    room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;
                }

                io.to(roomId).emit('leaderboard_update', {
                    leaderboard: Object.values(room.gameScores),
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds
                });
                io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `${username} left the match.`, type: 'default' });
            }

            // 🟢 LEAK SHIELD: If all players leave during match, save all earned scores to Turso first, then destroy room
            const activeSockets = await io.in(roomId).fetchSockets();
            const realSocketsRemaining = activeSockets.filter(s => s.data?.username && s.data.username !== username);

            if (realSocketsRemaining.length === 0) {
                console.log(`🧹 [In-Game Memory] All players abandoned Room [${roomId}]. Persisting scores and deleting room.`);
                if (room.gameScores) {
                    for (let user of Object.values(room.gameScores)) {
                        if (user.score > 0) {
                            try {
                                await db.run('UPDATE users SET score = score + ? WHERE username = ? AND is_suspended = 0', [user.score, user.name]);
                            } catch (err) { }
                        }
                    }
                }
                destroyEmptyRoomImmediately(roomId, "Match abandoned by all players");
                return;
            }

            const handler = getModeHandler(room.mode);
            if (handler.checkRoundCompletionAfterLeave) {
                handler.checkRoundCompletionAfterLeave(io, roomId, room);
            }
        };

        socket.on('player_leave_match', handleExplicitLeave);

        socket.on('submit_guess', (guessText) => {
            const { username, roomId } = socket.data;
            const room = activeRooms[roomId];

            if (!room || room.status !== 'started') return;

            if (room.isIntermission) {
                socket.emit('chat_message', { sender: "SYSTEM", text: "The round has already ended!", type: 'error' });
                return;
            }

            const profile = room.gameScores ? room.gameScores[username] : null;
            if (!profile || profile.hasLeft) return;

            const wasDisconnected = profile.isDisconnected;
            profile.isDisconnected = false;
            profile.hasInteractedThisRound = true;
            profile.hasInteractedThisRow = true;

            if (wasDisconnected) {
                io.to(roomId).emit('leaderboard_update', {
                    leaderboard: Object.values(room.gameScores),
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds
                });
            }

            if (isProfane(guessText, false)) {
                socket.emit('chat_message', {
                    sender: "SYSTEM",
                    text: community_TROLL_MESSAGE,
                    type: 'error'
                });
                return;
            }

            const handler = getModeHandler(room.mode);
            handler.processPlayerGuessSubmission(socket, io, roomId, room, profile, username, guessText);
        });

        socket.on('draw_stroke', (strokeData) => {
            const room = activeRooms[socket.data.roomId];
            if (room && room.status === 'started') {
                if (socket.data.username === room.currentPainter) {
                    room.painterDrewThisTurn = true;
                    if (room.gameScores && room.gameScores[socket.data.username]) {
                        const wasDisc = room.gameScores[socket.data.username].isDisconnected;
                        room.gameScores[socket.data.username].isDisconnected = false;
                        if (wasDisc) {
                            io.to(socket.data.roomId).emit('leaderboard_update', {
                                leaderboard: Object.values(room.gameScores),
                                currentRound: room.currentRound,
                                maxRounds: room.maxRounds
                            });
                        }
                    }
                }
                const handler = getModeHandler(room.mode);
                if (handler.handleDrawStroke) handler.handleDrawStroke(socket, io, room, strokeData);
            }
        });

        socket.on('clear_canvas', () => {
            const room = activeRooms[socket.data.roomId];
            if (room && room.status === 'started') {
                if (socket.data.username === room.currentPainter) {
                    room.painterDrewThisTurn = true;
                    if (room.gameScores && room.gameScores[socket.data.username]) {
                        room.gameScores[socket.data.username].isDisconnected = false;
                    }
                }
                const handler = getModeHandler(room.mode);
                if (handler.handleClearCanvas) handler.handleClearCanvas(socket, io, room);
            }
        });

        const handleUndoAction = () => {
            const room = activeRooms[socket.data.roomId];
            if (room && room.status === 'started') {
                if (socket.data.username === room.currentPainter) {
                    room.painterDrewThisTurn = true;
                    if (room.gameScores && room.gameScores[socket.data.username]) {
                        room.gameScores[socket.data.username].isDisconnected = false;
                    }
                }
                const handler = getModeHandler(room.mode);
                if (handler.handleUndo) handler.handleUndo(socket, io, room);
            }
        };

        socket.on('undo_stroke', handleUndoAction);
        socket.on('undo_canvas', handleUndoAction);

        socket.on('disconnect', async () => {
            const { username, roomId } = socket.data;
            console.log(`🔌 [Socket.IO] Client disconnected: ${socket.id} (User: ${username || 'unidentified'}, Room: ${roomId || 'none'})`);

            if (roomId && activeRooms[roomId]) {
                const room = activeRooms[roomId];

                if (room.isCustom && room.readyPlayers && username) {
                    room.readyPlayers.delete(username);
                }

                // ========================================================
                // 🟢 BRANCH 1: QUEUE DISCONNECT (Waiting Rooms Only)
                // ========================================================
                if (room.status === 'waiting') {
                    if (username) {
                        room.players = room.players.filter(name => name !== username);
                    }
                    console.log(`🚪 [Queue Disconnect] Room [${roomId}] player count now: ${room.players.length}`);
                    io.to(roomId).emit('update_room_ui', { players: room.players });

                    // Instant deletion for empty public queue; 30s for custom rooms
                    if (room.players.length === 0) {
                        if (!room.isCustom) {
                            destroyEmptyRoomImmediately(roomId, "Public queue emptied");
                        } else {
                            if (deletionTimeouts[roomId]) clearTimeout(deletionTimeouts[roomId]);
                            deletionTimeouts[roomId] = setTimeout(() => {
                                if (activeRooms[roomId] && activeRooms[roomId].status === 'waiting' && activeRooms[roomId].players.length === 0) {
                                    destroyEmptyRoomImmediately(roomId, "Custom party abandoned");
                                }
                            }, 30000);
                        }
                    }
                }
                // ========================================================
                // 🟢 BRANCH 2: IN-GAME DISCONNECT (Saves Scores First)
                // ========================================================
                else {
                    const activeSockets = await io.in(roomId).fetchSockets();

                    // If zero human sockets remain in the active game, save scores & destroy room
                    if (activeSockets.length === 0 || (activeSockets.length === 1 && activeSockets[0].id === socket.id)) {
                        console.log(`🧹 [In-Game Memory] All players abandoned Room [${roomId}]. Persisting scores and deleting room.`);
                        if (room.gameScores) {
                            for (let user of Object.values(room.gameScores)) {
                                if (user.score > 0) {
                                    try {
                                        await db.run('UPDATE users SET score = score + ? WHERE username = ? AND is_suspended = 0', [user.score, user.name]);
                                    } catch (err) { }
                                }
                            }
                        }
                        destroyEmptyRoomImmediately(roomId, "In-game match abandoned by all players");
                        return;
                    }

                    const isStillConnected = activeSockets.some(s => s.data && s.data.username === username && s.id !== socket.id);
                    if (isStillConnected) {
                        return;
                    }

                    if (username && room.gameScores && room.gameScores[username] && !room.gameScores[username].hasLeft) {
                        room.gameScores[username].isDisconnected = true;
                        if (room.mode === 4) {
                            room.gameScores[username].score = 0; // Disconnected player in Mode 4 forfeits points
                        }

                        if (room.mode === 1) {
                            const activeList = room.initialPlayers || room.players;
                            const eligibleRemaining = activeList.filter(pName => {
                                const p = room.gameScores[pName];
                                return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
                            });
                            room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;
                        }

                        io.to(roomId).emit('leaderboard_update', {
                            leaderboard: Object.values(room.gameScores),
                            currentRound: room.currentRound,
                            maxRounds: room.maxRounds
                        });

                        const handler = getModeHandler(room.mode);
                        if (handler.checkRoundCompletionAfterLeave) {
                            handler.checkRoundCompletionAfterLeave(io, roomId, room);
                        }
                    }
                }
            }
        });
    });
}

module.exports = setupSockets;