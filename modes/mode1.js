// modes/mode1.js
const { masterPixelaryData, loadPixelaryData } = require('../config');
const { executeIntermissionHalt } = require('../gameCore');

module.exports = {
    // 🟢 PRE-ROUND CHECK: Dynamically caps maxRounds BEFORE the engine increments currentRound
    beforeNextRound(room) {
        if (!room.paintedPlayers) room.paintedPlayers = [];

        const activeList = room.initialPlayers || room.players;
        const eligibleRemaining = activeList.filter(pName => {
            const p = room.gameScores[pName];
            return p && !p.hasLeft && !p.isDisconnected && !room.paintedPlayers.includes(pName);
        });

        // If no active players remain to draw, cap maxRounds so the match ends cleanly
        if (eligibleRemaining.length === 0) {
            room.maxRounds = room.paintedPlayers.length;
        } else {
            room.maxRounds = room.paintedPlayers.length + eligibleRemaining.length;
        }
    },

    pickRoundTargetWord(room) {
        if (!room.paintedPlayers) room.paintedPlayers = [];

        // 1. Filter strictly ACTIVE and connected players who haven't painted yet
        const activeList = room.initialPlayers || room.players;
        const eligibleRemaining = activeList.filter(pName => {
            const p = room.gameScores[pName];
            return p && !p.hasLeft && !p.isDisconnected && !room.paintedPlayers.includes(pName);
        });

        // 2. If no eligible active players remain, conclude match immediately
        if (eligibleRemaining.length === 0) {
            room.maxRounds = room.paintedPlayers.length;
            room.currentRound = room.maxRounds + 1;
            return;
        }

        // 3. Pick the next eligible active painter
        const selectedPainter = eligibleRemaining[0];
        room.currentPainter = selectedPainter;
        room.paintedPlayers.push(selectedPainter);
        room.painterDrewThisTurn = false;

        // 4. Set accurate max rounds
        room.maxRounds = room.paintedPlayers.length + (eligibleRemaining.length - 1);
        if (room.currentRound > room.maxRounds) {
            room.maxRounds = room.currentRound;
        }

        let categories = Object.keys(masterPixelaryData);
        if (categories.length === 0) {
            loadPixelaryData();
            categories = Object.keys(masterPixelaryData);
        }

        if (categories.length === 0) {
            room.currentCategory = "General";
            room.currentWord = "STEVE";
        } else {
            const randomCatIndex = Math.floor(Math.random() * categories.length);
            const selectedCategory = categories[randomCatIndex];
            const categoryItems = masterPixelaryData[selectedCategory];

            const randomItemIndex = Math.floor(Math.random() * categoryItems.length);
            const rawTarget = categoryItems.splice(randomItemIndex, 1)[0] || "STEVE";

            if (categoryItems.length === 0) delete masterPixelaryData[selectedCategory];

            room.currentCategory = selectedCategory;
            room.currentWord = String(rawTarget).trim().toUpperCase();
        }

        room.canvasHistory = [];

        if (room.gameScores) {
            Object.keys(room.gameScores).forEach(user => {
                if (room.gameScores[user]) room.gameScores[user].hasInteractedThisRound = false;
            });
        }
    },

    configureRoundClocks(room, roomId) {
        room.roundDuration = 120;
        room.hintInterval = 9999;
        room.matchClock = room.roundDuration;
        room.hintClock = room.hintInterval;
    },

    onClockSecondTick(room, io, roomId) {
        // 60-Second Painter Inactivity Detection
        if (room.matchClock <= 60 && !room.painterDrewThisTurn && !room.isIntermission) {
            const painterName = room.currentPainter;
            if (room.gameScores && room.gameScores[painterName]) {
                room.gameScores[painterName].isDisconnected = true;
            }

            io.to(roomId).emit('chat_message', {
                sender: "SYSTEM",
                text: `${painterName} was inactive for 60 seconds. Drawing turn skipped.`,
                type: 'error'
            });

            // Mark inactive guessers too
            this.checkInactivityAtEndOfRound(room);

            const activeList = room.initialPlayers || room.players;
            const eligibleRemaining = activeList.filter(pName => {
                const p = room.gameScores[pName];
                return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
            });
            room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;

            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });

            if (room.interval) clearInterval(room.interval);
            executeIntermissionHalt(roomId);
        }
    },

    processPlayerGuessSubmission(socket, io, roomId, room, profile, username, guessText) {
        const cleanGuess = guessText.trim().toUpperCase();

        if (username === room.currentPainter) {
            socket.emit('chat_message', { sender: "SYSTEM", text: "You are drawing this round!", type: 'error' });
            return;
        }

        // 1. Immediately wake up player in state
        const wasDisconnected = profile.isDisconnected;
        profile.isDisconnected = false;
        profile.hasInteractedThisRound = true;

        if (wasDisconnected) {
            const activeList = room.initialPlayers || room.players;
            const eligibleRemaining = activeList.filter(pName => {
                const p = room.gameScores[pName];
                return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
            });
            room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;

            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });
        }

        if (profile.hasGuessed) {
            io.to(roomId).emit('chat_message', { sender: username, text: guessText, type: 'default' });
            return;
        }

        // 2. Process guess
        if (cleanGuess === room.currentWord) {
            profile.hasGuessed = true;
            room.correctGuessesCount = (room.correctGuessesCount || 0) + 1;

            const GUESSER_POINTS = 120;
            const PAINTER_POINTS = 30;

            profile.score += GUESSER_POINTS;
            if (room.gameScores[room.currentPainter]) {
                room.gameScores[room.currentPainter].score += PAINTER_POINTS;
            }

            io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `🎉 ${username} guessed it! (+${GUESSER_POINTS} pts)`, type: 'success' });
            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });

            // 3. 🟢 DYNAMIC COMPLETION CHECK: Only ends when EVERY connected active guesser has solved it!
            const activeList = room.initialPlayers || room.players;
            const activeGuessers = activeList.filter(pName => {
                const p = room.gameScores[pName];
                return pName !== room.currentPainter && p && !p.hasLeft && !p.isDisconnected;
            });

            const allActiveGuessersFinished = activeGuessers.every(pName => {
                const p = room.gameScores[pName];
                return p && p.hasGuessed;
            });

            if (allActiveGuessersFinished && activeGuessers.length > 0) {
                this.checkInactivityAtEndOfRound(room);
                if (room.interval) clearInterval(room.interval);
                executeIntermissionHalt(roomId);
            }
        } else {
            io.to(roomId).emit('chat_message', { sender: username, text: guessText, type: 'default' });
        }
    },

    onPlayerReconnectRehydrate(socket, room, username) {
        const isPainter = (username === room.currentPainter);
        socket.emit('pixelary_role_init', {
            isPainter: isPainter,
            painterName: room.currentPainter,
            category: room.currentCategory,
            secretWord: isPainter ? room.currentWord : null,
            canvasHistory: room.canvasHistory || []
        });
    },

    handleDrawStroke(socket, io, room, strokeData) {
        if (socket.data.username !== room.currentPainter) return;
        room.painterDrewThisTurn = true;
        if (!room.canvasHistory) room.canvasHistory = [];
        room.canvasHistory.push(strokeData);
        socket.to(socket.data.roomId).emit('draw_stroke', strokeData);
    },

    handleClearCanvas(socket, io, room) {
        if (socket.data.username !== room.currentPainter) return;
        room.painterDrewThisTurn = true;
        room.canvasHistory = [];
        io.to(socket.data.roomId).emit('clear_canvas');
    },

    handleUndo(socket, io, room) {
        if (socket.data.username !== room.currentPainter) return;
        room.painterDrewThisTurn = true;
        if (room.canvasHistory && room.canvasHistory.length > 0) {
            const lastId = room.canvasHistory[room.canvasHistory.length - 1].strokeId;
            while (room.canvasHistory.length > 0 && room.canvasHistory[room.canvasHistory.length - 1].strokeId === lastId) {
                room.canvasHistory.pop();
            }
            io.to(socket.data.roomId).emit('canvas_redraw_all', { history: room.canvasHistory });
        }
    },

    // 🟢 DYNAMIC ROUND ADJUSTMENT: Marks inactive guessers AND painters
    checkInactivityAtEndOfRound(room) {
        if (!room.gameScores) return;
        Object.keys(room.gameScores).forEach(name => {
            const p = room.gameScores[name];
            if (!p || p.hasLeft) return;

            if (name === room.currentPainter) {
                if (!room.painterDrewThisTurn) p.isDisconnected = true;
            } else {
                if (!p.hasInteractedThisRound && !p.hasGuessed) p.isDisconnected = true;
            }
        });

        // Recalculate max rounds with all new disconnects
        const activeList = room.initialPlayers || room.players;
        const eligibleRemaining = activeList.filter(pName => {
            const p = room.gameScores[pName];
            return p && !p.hasLeft && !p.isDisconnected && (!room.paintedPlayers || !room.paintedPlayers.includes(pName));
        });

        room.maxRounds = (room.paintedPlayers ? room.paintedPlayers.length : 0) + eligibleRemaining.length;
    },

    checkRoundCompletionAfterLeave(io, roomId, room) {
        if (!room || room.status !== 'started' || room.isIntermission) return;

        const painterProfile = room.gameScores[room.currentPainter];
        if (painterProfile && (painterProfile.hasLeft || painterProfile.isDisconnected)) {
            io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `Active painter disconnected. Advancing turn...`, type: 'default' });
            this.checkInactivityAtEndOfRound(room);
            if (room.interval) clearInterval(room.interval);
            executeIntermissionHalt(roomId);
            return;
        }

        const activeList = room.initialPlayers || room.players;
        const activeGuessers = activeList.filter(pName => {
            const p = room.gameScores[pName];
            return pName !== room.currentPainter && p && !p.hasLeft && !p.isDisconnected;
        });

        const allActiveGuessersFinished = activeGuessers.every(pName => {
            const p = room.gameScores[pName];
            return p && p.hasGuessed;
        });

        if (allActiveGuessersFinished && activeGuessers.length > 0) {
            this.checkInactivityAtEndOfRound(room);
            if (room.interval) clearInterval(room.interval);
            executeIntermissionHalt(roomId);
        }
    }
};