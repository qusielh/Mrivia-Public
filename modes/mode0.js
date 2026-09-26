// modes/mode0.js
const { masterTriviaData, loadMriviaData, generateMaskedPayload } = require('../config');
const { executeIntermissionHalt } = require('../gameCore');

function unmaskRandomIndexSlot(room, roomId) {
    const letterCount = room.currentWord.replace(/[^A-Z]/g, '').length;
    if (room.lettersExposedCount >= letterCount - 1) return;

    const unrevealedIndices = [];
    for (let i = 0; i < room.currentWord.length; i++) {
        if (!room.revealedPositions[i] && /[A-Z]/.test(room.currentWord[i])) {
            unrevealedIndices.push(i);
        }
    }

    if (unrevealedIndices.length > 0) {
        const randomIdx = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
        room.revealedPositions[randomIdx] = true;
        room.lettersExposedCount = (room.lettersExposedCount || 0) + 1;
    }
}

module.exports = {
    pickRoundTargetWord(room) {
        let availableCategories = Object.keys(masterTriviaData);

        if (availableCategories.length === 0) {
            loadMriviaData();
            availableCategories = Object.keys(masterTriviaData);
        }

        if (!room.categoryQueue || room.categoryQueue.length === 0) {
            room.categoryQueue = availableCategories.sort(() => Math.random() - 0.5);
        }

        let randomCategory = room.categoryQueue.shift();

        if (!masterTriviaData[randomCategory] || masterTriviaData[randomCategory].length === 0) {
            delete masterTriviaData[randomCategory];
            const remaining = Object.keys(masterTriviaData);
            if (remaining.length === 0) {
                loadMriviaData();
                randomCategory = Object.keys(masterTriviaData)[0];
            } else {
                randomCategory = remaining[Math.floor(Math.random() * remaining.length)];
            }
        }

        room.currentCategory = randomCategory;

        const categoryArray = masterTriviaData[randomCategory];
        const randomIndex = Math.floor(Math.random() * categoryArray.length);

        const rawTarget = categoryArray.splice(randomIndex, 1)[0];

        if (categoryArray.length === 0) {
            delete masterTriviaData[randomCategory];
        }

        room.currentWord = (typeof rawTarget === 'object' && rawTarget.name) ? rawTarget.name.toUpperCase() : (typeof rawTarget === 'object' && rawTarget.word) ? rawTarget.word.toUpperCase() : String(rawTarget).toUpperCase();

        if (room.gameScores) {
            Object.keys(room.gameScores).forEach(user => {
                const p = room.gameScores[user];
                p.hasGuessed = false;
                p.hasInteractedThisRound = false;
            });
        }
    },

    configureRoundClocks(room, roomId) {
        const letterCount = room.currentWord.replace(/[^A-Z]/g, '').length;
        unmaskRandomIndexSlot(room, roomId);
        room.hintInterval = 8;
        room.roundDuration = Math.max(8, (letterCount - 1) * 8);

        room.matchClock = room.roundDuration;
        room.hintClock = room.hintInterval;
    },

    onClockSecondTick(room, io, roomId, letterCount) {
        if (room.hintClock <= 0 && room.matchClock > 0) {
            room.hintClock = room.hintInterval;
            if (room.lettersExposedCount < letterCount - 1) {
                unmaskRandomIndexSlot(room, roomId);
                io.to(roomId).emit('hint_update', {
                    maskedWord: generateMaskedPayload(room.currentWord, room.revealedPositions)
                });
            }
        }
    },

    processPlayerGuessSubmission(socket, io, roomId, room, profile, username, guessText) {
        // 1. Immediately wake up player and clear disconnected status
        const wasDisconnected = profile.isDisconnected;
        profile.isDisconnected = false;
        profile.hasInteractedThisRound = true;

        const cleanGuess = guessText.trim().toUpperCase();

        // If they were disconnected, immediately broadcast updated leaderboard to clear the badge on everyone's screen
        if (wasDisconnected) {
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

        // 2. Evaluate guess
        if (cleanGuess === room.currentWord) {
            profile.hasGuessed = true;
            room.correctGuessesCount += 1;

            let pointsAwarded = 160 - ((room.correctGuessesCount - 1) * 20);
            if (pointsAwarded < 20) pointsAwarded = 20;

            profile.score += pointsAwarded;

            io.to(roomId).emit('chat_message', {
                sender: "SYSTEM",
                text: `${username} guessed correctly! Placement #${room.correctGuessesCount} (+${pointsAwarded} pts)`,
                type: 'success'
            });
            io.to(roomId).emit('leaderboard_update', {
                leaderboard: Object.values(room.gameScores),
                currentRound: room.currentRound,
                maxRounds: room.maxRounds
            });

            // 3. Recalculate active players using freshly updated state
            const activeList = room.initialPlayers || room.players;
            const remainingActive = activeList.filter(pName => {
                const pProfile = room.gameScores[pName];
                return pProfile && !pProfile.hasLeft && !pProfile.isDisconnected;
            });

            const allPlayersFinished = remainingActive.every(pName => {
                const pProfile = room.gameScores[pName];
                return pProfile && pProfile.hasGuessed;
            });

            if (allPlayersFinished && remainingActive.length > 0) {
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
            const pProfile = room.gameScores[pName];
            return pProfile && !pProfile.hasLeft && !pProfile.isDisconnected;
        });

        const allPlayersFinished = remainingActive.every(pName => {
            const pProfile = room.gameScores[pName];
            return pProfile && pProfile.hasGuessed;
        });

        if (allPlayersFinished && remainingActive.length > 0) {
            this.checkInactivityAtEndOfRound(room);
            if (room.interval) clearInterval(room.interval);
            executeIntermissionHalt(roomId);
        }
    }
};