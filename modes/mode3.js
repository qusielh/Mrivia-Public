// modes/mode3.js
const fs = require('fs');
const path = require('path');
const { masterMineleData, loadMineleData } = require('../config');
const { executeIntermissionHalt } = require('../gameCore');

let cachedDictionary = null;
function getValidWordDictionary() {
    if (!cachedDictionary) {
        try {
            const raw = fs.readFileSync(path.join(__dirname, '../minele_data.json'), 'utf8');
            cachedDictionary = JSON.parse(raw);
        } catch (e) { cachedDictionary = masterMineleData; }
    }
    return cachedDictionary;
}

function evaluateFeedback(guess, target) {
    let feedback = new Array(target.length).fill('absent');
    let targetArr = target.split('');
    let guessArr = guess.split('');

    for (let i = 0; i < target.length; i++) {
        if (guessArr[i] === targetArr[i]) {
            feedback[i] = 'correct'; targetArr[i] = null; guessArr[i] = null;
        }
    }
    for (let i = 0; i < target.length; i++) {
        if (guessArr[i] !== null) {
            let idx = targetArr.indexOf(guessArr[i]);
            if (idx !== -1) { feedback[i] = 'present'; targetArr[idx] = null; }
        }
    }
    return feedback;
}

module.exports = {
    pickRoundTargetWord(room) {
        let categories = Object.keys(masterMineleData);
        if (categories.length === 0) {
            loadMineleData();
            categories = Object.keys(masterMineleData);
        }

        const randomKey = categories[Math.floor(Math.random() * categories.length)];
        const categoryPool = masterMineleData[randomKey];
        const idx = Math.floor(Math.random() * categoryPool.length);

        room.currentWord = categoryPool.splice(idx, 1)[0].toUpperCase();
        if (categoryPool.length === 0) delete masterMineleData[randomKey];

        room.totalAttempts = (room.currentWord.length === 3) ? 4 : room.currentWord.length;
        room.currentSyncRow = 0;
        room.solversInOrder = [];

        if (room.gameScores) {
            Object.keys(room.gameScores).forEach(user => {
                if (room.gameScores[user]) {
                    room.gameScores[user].hasInteractedThisRow = false;
                }
            });
        }
    },

    configureRoundClocks(room, roomId) {
        room.matchClock = 90;
    },

    processPlayerGuessSubmission(socket, io, roomId, room, profile, username, guessText) {
        // 1. Immediately wake up player in state (even if guess is invalid word like "asd")
        const wasDisconnected = profile.isDisconnected;
        profile.isDisconnected = false;
        profile.hasInteractedThisRow = true;

        if (wasDisconnected) {
            io.to(roomId).emit('leaderboard_update', { leaderboard: Object.values(room.gameScores) });
        }

        const guess = guessText.trim().toUpperCase();
        if (profile.isFinishedCorrectly || profile.hasSubmittedCurrentRow) return;

        const categoryKey = `${room.currentWord.length}_characters`;
        const dict = getValidWordDictionary();
        const dictionary = (dict && dict[categoryKey]) ? dict[categoryKey] : [];
        const isValid = dictionary.some(w => w.toUpperCase() === guess);

        if (!isValid) {
            socket.emit('minele_invalid_word', { message: "Invalid Word" });
            return;
        }

        // 2. Evaluate Wordle feedback
        const feedback = evaluateFeedback(guess, room.currentWord);
        profile.hasSubmittedCurrentRow = true;
        profile.pendingGuess = guess;
        profile.lastFeedback = feedback;

        const SCORING = [200, 150, 100, 50];

        if (guess === room.currentWord) {
            profile.isFinishedCorrectly = true;
            profile.score += SCORING[room.solversInOrder.length] || 25;
            room.solversInOrder.push(username);
            io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `🎉 ${username} solved it!`, type: 'success' });
        }

        socket.emit('minele_row_result', { row: room.currentSyncRow, feedback: feedback, lockState: 1 });
        io.to(roomId).emit('leaderboard_update', { leaderboard: Object.values(room.gameScores) });

        // 3. Recalculate active racers
        const activeRacers = room.initialPlayers.filter(p => {
            const pProfile = room.gameScores[p];
            return pProfile && !pProfile.isFinishedCorrectly && !pProfile.hasLeft && !pProfile.isDisconnected;
        });
        const submittedRacers = activeRacers.filter(p => room.gameScores[p].hasSubmittedCurrentRow);

        if (submittedRacers.length >= activeRacers.length && activeRacers.length > 0) {
            this.processEndOfSyncRow(io, roomId, room);
        } else {
            const roundFinished = room.initialPlayers.every(name => {
                const p = room.gameScores[name];
                return !p || p.hasLeft || p.isDisconnected || p.isFinishedCorrectly || room.currentSyncRow >= room.totalAttempts;
            });

            if (roundFinished) {
                this.checkInactivityAtEndOfRow(room);
                if (room.interval) clearInterval(room.interval);
                setTimeout(() => executeIntermissionHalt(roomId), 1500);
            }
        }
    },

    // 🟢 1 Full Attempt Inactivity Check: completely silent players become isDisconnected
    checkInactivityAtEndOfRow(room) {
        if (!room.gameScores) return;
        Object.keys(room.gameScores).forEach(name => {
            const p = room.gameScores[name];
            if (p && !p.hasLeft && !p.isFinishedCorrectly) {
                if (!p.hasInteractedThisRow) {
                    p.isDisconnected = true;
                }
            }
        });
    },

    processEndOfSyncRow(io, roomId, room) {
        const SCORING = [200, 150, 100, 50];

        // 1. Run AFK check at the end of the attempt
        this.checkInactivityAtEndOfRow(room);

        room.initialPlayers.forEach(name => {
            const p = room.gameScores[name];
            if (!p) return;

            const guess = p.pendingGuess || "".padEnd(room.currentWord.length, " ");
            const feedback = p.lastFeedback || evaluateFeedback(guess, room.currentWord);

            if (!p.attempts) p.attempts = [];
            p.attempts.push({ guess, feedback });

            if (guess === room.currentWord && !p.isFinishedCorrectly) {
                p.isFinishedCorrectly = true;
                p.score += SCORING[room.solversInOrder.length] || 25;
                room.solversInOrder.push(name);
                io.to(roomId).emit('chat_message', { sender: "SYSTEM", text: `🎉 ${name} solved it!`, type: 'success' });
            }

            p.hasSubmittedCurrentRow = false;
            p.pendingGuess = null;
            p.lastFeedback = null;
            p.hasInteractedThisRow = false; // reset for next row attempt
        });

        room.currentSyncRow++;
        room.matchClock = 90;

        io.to(roomId).emit('minele_next_row', { newRow: room.currentSyncRow, leaderboard: Object.values(room.gameScores) });

        const roundFinished = room.initialPlayers.every(name => {
            const p = room.gameScores[name];
            return !p || p.hasLeft || p.isDisconnected || p.isFinishedCorrectly || room.currentSyncRow >= room.totalAttempts;
        });

        if (roundFinished) {
            if (room.interval) clearInterval(room.interval);
            setTimeout(() => executeIntermissionHalt(roomId), 1500);
        }
    },

    checkRoundCompletionAfterLeave(io, roomId, room) {
        if (!room || room.status !== 'started' || room.isIntermission) return;

        const activeRacers = room.initialPlayers.filter(p => {
            const pProfile = room.gameScores[p];
            return pProfile && !pProfile.isFinishedCorrectly && !pProfile.hasLeft && !pProfile.isDisconnected;
        });
        const submittedRacers = activeRacers.filter(p => room.gameScores[p].hasSubmittedCurrentRow);

        if (submittedRacers.length >= activeRacers.length && activeRacers.length > 0) {
            this.processEndOfSyncRow(io, roomId, room);
        } else {
            const roundFinished = room.initialPlayers.every(name => {
                const p = room.gameScores[name];
                return !p || p.hasLeft || p.isDisconnected || p.isFinishedCorrectly || room.currentSyncRow >= room.totalAttempts;
            });

            if (roundFinished) {
                this.checkInactivityAtEndOfRow(room);
                if (room.interval) clearInterval(room.interval);
                setTimeout(() => executeIntermissionHalt(roomId), 1500);
            }
        }
    }
};