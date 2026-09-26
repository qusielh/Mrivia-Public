// modes/mode2.js
const { masterRecipeData, loadRecipeData } = require('../config');
const { executeIntermissionHalt } = require('../gameCore');

module.exports = {
    pickRoundTargetWord(room) {
        let itemKeys = Object.keys(masterRecipeData);

        if (itemKeys.length === 0) {
            loadRecipeData();
            itemKeys = Object.keys(masterRecipeData);
        }

        const randomItemKey = itemKeys[Math.floor(Math.random() * itemKeys.length)];
        const variants = masterRecipeData[randomItemKey];
        const selectedRecipe = variants[Math.floor(Math.random() * variants.length)];

        delete masterRecipeData[randomItemKey];

        room.currentWord = randomItemKey.toUpperCase();
        room.currentCategory = "Crafting Recipe";
        room.slotRevealQueue = [];

        Object.keys(selectedRecipe).forEach(imagePath => {
            const ingredient = selectedRecipe[imagePath];
            if (ingredient.slots && Array.isArray(ingredient.slots)) {
                ingredient.slots.forEach(slotNumber => {
                    room.slotRevealQueue.push({ slot: slotNumber, src: imagePath, alt: ingredient.alt || "" });
                });
            }
        });

        for (let i = room.slotRevealQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [room.slotRevealQueue[i], room.slotRevealQueue[j]] = [room.slotRevealQueue[j], room.slotRevealQueue[i]];
        }

        room.revealedSlots = [];
        const initialSlot = room.slotRevealQueue.shift();
        if (initialSlot) room.revealedSlots.push(initialSlot);

        if (room.gameScores) {
            Object.keys(room.gameScores).forEach(user => {
                if (room.gameScores[user]) room.gameScores[user].hasInteractedThisRound = false;
            });
        }
    },

    configureRoundClocks(room, roomId) {
        const totalSlots = room.revealedSlots.length + room.slotRevealQueue.length;
        room.roundDuration = totalSlots * 7;
        room.hintInterval = 7;
        room.matchClock = room.roundDuration;
        room.hintClock = room.hintInterval;
    },

    onClockSecondTick(room, io, roomId) {
        if (room.hintClock <= 0 && room.slotRevealQueue.length > 0) {
            room.hintClock = 7;
            const nextSlot = room.slotRevealQueue.shift();
            room.revealedSlots.push(nextSlot);
            io.to(roomId).emit('recipe_slot_reveal', nextSlot);
        }
    },

    processPlayerGuessSubmission(socket, io, roomId, room, profile, username, guessText) {
        // 1. Immediately wake up player state
        const wasDisconnected = profile.isDisconnected;
        profile.isDisconnected = false;
        profile.hasInteractedThisRound = true;

        if (wasDisconnected) {
            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });
        }

        const cleanGuess = guessText.trim().toUpperCase().replace(/\s+/g, '_');
        const targetWord = room.currentWord.toUpperCase().replace(/\s+/g, '_');

        if (profile.hasGuessed) {
            io.to(roomId).emit('chat_message', { sender: username, text: guessText, type: 'default' });
            return;
        }

        // 2. Evaluate recipe guess
        if (cleanGuess === targetWord) {
            profile.hasGuessed = true;
            room.correctGuessesCount += 1;

            const SCORING = [200, 150, 100, 50];
            const pointsAwarded = SCORING[room.correctGuessesCount - 1] || 25;
            profile.score += pointsAwarded;

            io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `🎉 ${username} resolved the recipe! Placement #${room.correctGuessesCount} (+${pointsAwarded} pts)`, type: 'success' });
            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });

            // 3. 🟢 DYNAMIC COMPLETION CHECK: Only ends when EVERY connected active player has guessed!
            const activeList = room.initialPlayers || room.players;
            const remainingActive = activeList.filter(pName => {
                const p = room.gameScores[pName];
                return p && !p.hasLeft && !p.isDisconnected;
            });

            const allActiveFinished = remainingActive.every(pName => {
                const p = room.gameScores[pName];
                return p && p.hasGuessed;
            });

            if (allActiveFinished && remainingActive.length > 0) {
                this.checkInactivityAtEndOfRound(room);
                if (room.interval) clearInterval(room.interval);
                executeIntermissionHalt(roomId);
            }
        } else {
            io.to(roomId).emit('chat_message', { sender: username, text: guessText, type: 'default' });
        }
    },

    checkInactivityAtEndOfRound(room) {
        if (!room.gameScores) return;
        Object.keys(room.gameScores).forEach(name => {
            const p = room.gameScores[name];
            if (p && !p.hasLeft && !p.hasInteractedThisRound && !p.hasGuessed) {
                p.isDisconnected = true;
            }
        });
    },

    checkRoundCompletionAfterLeave(io, roomId, room) {
        if (!room || room.status !== 'started' || room.isIntermission) return;
        const activeList = room.initialPlayers || room.players;
        const remainingActive = activeList.filter(pName => {
            const p = room.gameScores[pName];
            return p && !p.hasLeft && !p.isDisconnected;
        });

        const allActiveFinished = remainingActive.every(pName => {
            const p = room.gameScores[pName];
            return p && p.hasGuessed;
        });

        if (allActiveFinished && remainingActive.length > 0) {
            this.checkInactivityAtEndOfRound(room);
            if (room.interval) clearInterval(room.interval);
            executeIntermissionHalt(roomId);
        }
    }
};