// gameCore.js
const {
    ROUND_LIMITS,
    activeRooms,
    deletionTimeouts,
    masterTriviaData,
    masterPixelaryData,
    masterMineleData,
    masterRecipeData,
    generateMaskedPayload
} = require('./config');

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

let io, db;

function initCoreEngine(ioInstance, dbInstance) {
    io = ioInstance;
    db = dbInstance;
}

function getModeHandler(modeId) {
    return require(`./modes/mode${modeId}`);
}

function startRoomTimer(roomId) {
    if (!activeRooms[roomId] || activeRooms[roomId].interval) return;

    if (activeRooms[roomId].timer === undefined || activeRooms[roomId].timer > 10) {
        activeRooms[roomId].timer = 120;
    }

    const currentIntervalId = setInterval(() => {
        const room = activeRooms[roomId];
        if (!room) {
            clearInterval(currentIntervalId);
            return;
        }

        room.timer -= 1;

        if (room.timer <= 0) {
            clearInterval(currentIntervalId);
            room.interval = null;

            if (room.players.length < 3) {
                io.to(roomId).emit('redirect_to_lobby', { reason: "Not enough players to start match." });
                room.status = 'deleting';

                if (deletionTimeouts[roomId]) {
                    clearTimeout(deletionTimeouts[roomId]);
                    delete deletionTimeouts[roomId];
                }

                // 🟢 INSTANT PURGE: Immediately erase underpopulated room from RAM and log it
                delete activeRooms[roomId];
                console.log(`🧹 [Room Purged] Underpopulated Room [${roomId}] (${room.players.length} players) erased from RAM.`);
            } else {
                console.log(`[Engine] Redirecting room ${roomId} (Mode: ${room.mode}) to game page...`);
                room.status = 'game_waiting';
                room.gameWaitingClock = 10;

                const targetUrl = GAME_MODE_URLS[room.mode] || '/mrivia';

                io.to(roomId).emit('redirect_to_game', { url: targetUrl });
                runGameWaitingPhase(roomId);
            }
            return;
        }

        io.to(roomId).emit('timer_update', { time: room.timer });
    }, 1000);

    activeRooms[roomId].interval = currentIntervalId;
}

function runGameWaitingPhase(roomId) {
    if (activeRooms[roomId].interval) {
        clearInterval(activeRooms[roomId].interval);
        activeRooms[roomId].interval = null;
    }

    const waitingIntervalId = setInterval(() => {
        const room = activeRooms[roomId];
        if (!room || room.status !== 'game_waiting') {
            clearInterval(waitingIntervalId);
            return;
        }

        room.gameWaitingClock -= 1;

        if (room.gameWaitingClock < 0) {
            clearInterval(waitingIntervalId);
            activeRooms[roomId].interval = null;

            room.status = 'game_countdown';
            room.gameCountdownClock = 5;

            io.to(roomId).emit('game_countdown_tick', { time: room.gameCountdownClock });
            runGameCountdownPhase(roomId);
            return;
        }

        io.to(roomId).emit('game_waiting_tick', { time: room.gameWaitingClock });
    }, 1000);

    activeRooms[roomId].interval = waitingIntervalId;
}

function runGameCountdownPhase(roomId) {
    if (activeRooms[roomId].interval) {
        clearInterval(activeRooms[roomId].interval);
        activeRooms[roomId].interval = null;
    }

    const countdownIntervalId = setInterval(() => {
        const room = activeRooms[roomId];
        if (!room || room.status !== 'game_countdown') {
            clearInterval(countdownIntervalId);
            return;
        }

        room.gameCountdownClock -= 1;

        if (room.gameCountdownClock === 0) {
            io.to(roomId).emit('game_countdown_tick', { time: 'START' });
            return;
        }

        if (room.gameCountdownClock < 0) {
            clearInterval(countdownIntervalId);
            activeRooms[roomId].interval = null;

            room.status = 'started';
            initiateUniversalGameLoop(roomId);
            return;
        }

        io.to(roomId).emit('game_countdown_tick', { time: room.gameCountdownClock });
    }, 1000);

    activeRooms[roomId].interval = countdownIntervalId;
}

function initiateUniversalGameLoop(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    room.currentRound = 0;
    room.maxRounds = ROUND_LIMITS[room.mode] || 10;

    room.initialPlayers = [...room.players];

    room.itemPools = {
        0: JSON.parse(JSON.stringify(masterTriviaData)),
        1: JSON.parse(JSON.stringify(masterPixelaryData)),
        2: JSON.parse(JSON.stringify(masterRecipeData)),
        3: JSON.parse(JSON.stringify(masterMineleData))
    };

    if (room.mode === 0) {
        room.categoryQueue = Object.keys(masterTriviaData).sort(() => Math.random() - 0.5);
    }

    room.gameScores = {};
    room.players.forEach(username => {
        room.gameScores[username] = {
            name: username,
            score: 0,
            hasGuessed: false,
            attempts: [],
            isFinishedCorrectly: false,
            hasSubmittedCurrentRow: false,
            hasLeft: false,
            isDisconnected: false,
            hasAbandoned: false
        };
    });

    executeNextEngineRound(roomId);
}

async function executeNextEngineRound(roomId) {
    const room = activeRooms[roomId];
    if (!room || room.status !== 'started') return;

    const handler = getModeHandler(room.mode);

    // 🟢 PRE-ROUND CHECK: Mode can recalculate maxRounds BEFORE incrementing currentRound
    if (handler.beforeNextRound) {
        handler.beforeNextRound(room);
    }

    room.currentRound += 1;

    if (room.currentRound > room.maxRounds) {
        terminateMatchConcludes(roomId);
        return;
    }

    if (!room.itemPools) {
        room.itemPools = {
            0: JSON.parse(JSON.stringify(masterTriviaData)),
            1: JSON.parse(JSON.stringify(masterPixelaryData)),
            2: JSON.parse(JSON.stringify(masterRecipeData)),
            3: JSON.parse(JSON.stringify(masterMineleData))
        };
    }

    handler.pickRoundTargetWord(room);

    // If pickRoundTargetWord determined no valid turns exist
    if (room.currentRound > room.maxRounds) {
        terminateMatchConcludes(roomId);
        return;
    }

    // 🟢 MODE 4 (SZC) LAUNCH HOOK
    if (room.mode === 4) {
        io.to(roomId).emit('szc_round_start', {
            round: room.currentRound,
            maxRounds: room.maxRounds
        });
        if (handler.startSZCTurnTicker) {
            handler.startSZCTurnTicker(io, roomId, room);
        }
        return;
    }

    room.revealedPositions = new Array(room.currentWord.length).fill(false);
    room.correctGuessesCount = 0;
    room.isIntermission = false;

    for (let i = 0; i < room.currentWord.length; i++) {
        if (!/[A-Z]/.test(room.currentWord[i])) {
            room.revealedPositions[i] = true;
        }
    }

    Object.keys(room.gameScores).forEach(user => {
        const p = room.gameScores[user];
        p.hasGuessed = false;
        p.attempts = [];
        p.isFinishedCorrectly = false;
        p.hasSubmittedCurrentRow = false;
    });

    const letterCount = room.currentWord.replace(/[^A-Z]/g, '').length;
    room.lettersExposedCount = 0;

    handler.configureRoundClocks(room, roomId);

    const roomSockets = await io.in(roomId).fetchSockets();
    roomSockets.forEach(socket => {
        const username = socket.data?.username;
        const isPainter = (room.mode === 1 && username === room.currentPainter);

        socket.emit('round_init', {
            round: room.currentRound,
            maxRounds: room.maxRounds,
            maskedWord: generateMaskedPayload(room.currentWord, room.revealedPositions),
            mode: room.mode,
            category: room.currentCategory,
            currentPainter: room.currentPainter || null,
            isPainter: isPainter,
            secretWord: (room.mode === 1 && isPainter) ? room.currentWord : (room.mode === 3 && isPainter) ? room.currentWord : null,
            wordLength: room.currentWord.length,
            totalAttempts: room.totalAttempts || 6,
            revealedSlots: room.revealedSlots || []
        });
    });

    io.to(roomId).emit('leaderboard_update', {
        leaderboard: Object.values(room.gameScores),
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
    });

    if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
    }

    const currentEngineIntervalId = setInterval(() => {
        if (!activeRooms[roomId]) {
            clearInterval(currentEngineIntervalId);
            return;
        }

        if (room.matchClock > 0) {
            room.matchClock -= 1;
            room.hintClock -= 1;

            if (handler.onClockSecondTick) {
                handler.onClockSecondTick(room, io, roomId, letterCount);
            }

            let displayHintClock = Math.max(0, room.hintClock);
            if ((room.mode !== 0 && room.mode !== 2) || (room.mode === 0 && room.lettersExposedCount >= letterCount - 1)) {
                displayHintClock = "--";
            }

            io.to(roomId).emit('clock_tick', {
                matchClock: Math.max(0, room.matchClock),
                hintClock: displayHintClock
            });
        }

        if (room.matchClock <= 0) {
            if (room.mode === 3 && room.status === 'started') {
                handler.processEndOfSyncRow(io, roomId, room);
                return;
            }

            if (handler.checkInactivityAtEndOfRound) {
                handler.checkInactivityAtEndOfRound(room);
                io.to(roomId).emit('leaderboard_update', {
                    leaderboard: Object.values(room.gameScores),
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds
                });
            }

            clearInterval(currentEngineIntervalId);
            room.interval = null;
            executeIntermissionHalt(roomId);
            return;
        }
    }, 1000);

    room.interval = currentEngineIntervalId;
}

function executeIntermissionHalt(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    room.isIntermission = true;
    room.intermissionClock = (room.mode === 4) ? 3 : 5; // 3 seconds for Mode 4, 5 seconds for others

    io.to(roomId).emit('round_intermission', {
        correctWord: room.currentWord,
        intermissionDuration: room.intermissionClock
    });

    if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
    }

    const intermissionIntervalId = setInterval(() => {
        if (!activeRooms[roomId]) {
            clearInterval(intermissionIntervalId);
            return;
        }

        room.intermissionClock -= 1;

        if (room.intermissionClock <= 0) {
            clearInterval(intermissionIntervalId);
            room.interval = null;
            executeNextEngineRound(roomId);
        } else {
            io.to(roomId).emit('intermission_tick', { time: room.intermissionClock });
        }
    }, 1000);

    room.interval = intermissionIntervalId;
}

async function terminateMatchConcludes(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    // 🟢 SAFE PERSISTENCE: Updates points to Turso database before destroying room
    if (room.gameScores) {
        for (let user of Object.values(room.gameScores)) {
            if (user.score > 0) {
                try {
                    await db.run('UPDATE users SET score = score + ? WHERE username = ? AND is_suspended = 0', [user.score, user.name]);
                } catch (err) {
                    console.error("Score update error on match conclude:", err);
                }
            }
        }
    }

    const sortedScores = Object.values(room.gameScores).sort((a, b) => b.score - a.score);
    io.to(roomId).emit('game_over', { winner: sortedScores[0] ? sortedScores[0].name : "None", finalLeaderboard: sortedScores });

    if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
    }

    if (deletionTimeouts[roomId]) {
        clearTimeout(deletionTimeouts[roomId]);
        delete deletionTimeouts[roomId];
    }

    delete activeRooms[roomId];
    console.log(`🧹 [Room Purged] Match concluded. Room [${roomId}] erased cleanly from RAM.`);
}

module.exports = {
    initCoreEngine,
    startRoomTimer,
    initiateUniversalGameLoop,
    executeNextEngineRound,
    executeIntermissionHalt,
    getModeHandler,
    runGameWaitingPhase
};