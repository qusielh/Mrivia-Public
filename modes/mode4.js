// modes/mode4.js
const { executeIntermissionHalt } = require('../gameCore');

const CHOICES = ['CREEPER', 'ZOMBIE', 'SKELETON'];

// Minecraft Lore Matrix:
// SKELETON beats CREEPER (arrows from range)
// CREEPER beats ZOMBIE (explodes melee swarm)
// ZOMBIE beats SKELETON (swarms and overpowers archer)
function evaluateRPS(choiceA, choiceB) {
    if (choiceA === choiceB) return 'tie';
    if (
        (choiceA === 'SKELETON' && choiceB === 'CREEPER') ||
        (choiceA === 'CREEPER' && choiceB === 'ZOMBIE') ||
        (choiceA === 'ZOMBIE' && choiceB === 'SKELETON')
    ) {
        return 'win';
    }
    return 'lose';
}

module.exports = {
    // Initializes the Best-of-5 state for SZC
    beforeNextRound(room) {
        if (!room.szcWins) {
            room.szcWins = {};
            room.players.forEach(p => {
                room.szcWins[p] = 0;
            });
        }
        if (!room.szcChoices) {
            room.szcChoices = {};
        }
    },

    pickRoundTargetWord(room) {
        room.currentWord = "SZC_DUEL";
        room.currentCategory = "Mob Duel";
        room.szcChoices = {};
        room.matchClock = 30; // 30-second turn clock
    },

    configureRoundClocks(room, roomId) {
        room.matchClock = 30;
        room.hintInterval = 9999;
        room.hintClock = 9999;
    },

    onClockSecondTick(room, io, roomId) {
        if (!room || room.status !== 'started') return;

        // Broadcast turn timer tick to both players
        io.to(roomId).emit('szc_timer_tick', { time: Math.max(0, room.matchClock) });

        // Auto-pick if 30s expires
        if (room.matchClock <= 0) {
            this.handleTimeoutAutoPick(io, roomId, room);
        }
    },

    // Handles player submitting a choice: CREEPER, ZOMBIE, or SKELETON
    handlePlayerChoice(socket, io, roomId, room, username, choice) {
        if (!room || room.status !== 'started') return;

        const cleanChoice = String(choice).trim().toUpperCase();
        if (!CHOICES.includes(cleanChoice)) return;

        if (!room.szcChoices) room.szcChoices = {};

        // Prevent changing pick once submitted
        if (room.szcChoices[username]) return;

        room.szcChoices[username] = cleanChoice;

        // Notify opponent that player is locked in (without revealing the choice!)
        socket.to(roomId).emit('szc_opponent_locked');

        // Check if both players have submitted (or if bot needs to pick)
        this.checkBothPlayersLocked(io, roomId, room);
    },

    checkBothPlayersLocked(io, roomId, room) {
        const activePlayers = room.initialPlayers || room.players;

        // If one player abandoned, bot auto-picks for them
        activePlayers.forEach(pName => {
            const pProfile = room.gameScores ? room.gameScores[pName] : null;
            if (pProfile && (pProfile.hasLeft || pProfile.isDisconnected) && !room.szcChoices[pName]) {
                const randomBotChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
                room.szcChoices[pName] = randomBotChoice;
            }
        });

        const lockedCount = Object.keys(room.szcChoices).length;

        // When both choices are in, execute simultaneous reveal
        if (lockedCount >= 2) {
            this.resolveRoundClash(io, roomId, room);
        }
    },

    // Auto-picks random choice if turn timer hits 0
    handleTimeoutAutoPick(io, roomId, room) {
        const activePlayers = room.initialPlayers || room.players;
        activePlayers.forEach(pName => {
            if (!room.szcChoices[pName]) {
                const randomChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
                room.szcChoices[pName] = randomChoice;
            }
        });
        this.resolveRoundClash(io, roomId, room);
    },

    async resolveRoundClash(io, roomId, room) {
        if (room.interval) {
            clearInterval(room.interval);
            room.interval = null;
        }

        const players = room.initialPlayers || room.players;
        if (players.length < 2) return;

        const p1 = players[0];
        const p2 = players[1];

        const choice1 = room.szcChoices[p1] || CHOICES[Math.floor(Math.random() * CHOICES.length)];
        const choice2 = room.szcChoices[p2] || CHOICES[Math.floor(Math.random() * CHOICES.length)];

        const resultForP1 = evaluateRPS(choice1, choice2); // 'win', 'lose', or 'tie'
        const resultForP2 = evaluateRPS(choice2, choice1);

        if (!room.szcWins) room.szcWins = { [p1]: 0, [p2]: 0 };

        let roundWinner = null;
        if (resultForP1 === 'win') {
            room.szcWins[p1] = (room.szcWins[p1] || 0) + 1;
            roundWinner = p1;
        } else if (resultForP2 === 'win') {
            room.szcWins[p2] = (room.szcWins[p2] || 0) + 1;
            roundWinner = p2;
        }

        // Send personalized reveal payloads to both sockets
        const roomSockets = await io.in(roomId).fetchSockets();
        roomSockets.forEach(sock => {
            const uName = sock.data?.username;
            if (uName === p1) {
                sock.emit('szc_round_reveal', {
                    yourChoice: choice1,
                    opponentChoice: choice2,
                    outcome: resultForP1,
                    yourScore: (room.szcWins[p1] || 0) * 50,
                    opponentScore: (room.szcWins[p2] || 0) * 50
                });
            } else if (uName === p2) {
                sock.emit('szc_round_reveal', {
                    yourChoice: choice2,
                    opponentChoice: choice1,
                    outcome: resultForP2,
                    yourScore: (room.szcWins[p2] || 0) * 50,
                    opponentScore: (room.szcWins[p1] || 0) * 50
                });
            }
        });

        // Check Best-of-5 Conclusion (First to 3 wins takes match)
        const p1Wins = room.szcWins[p1] || 0;
        const p2Wins = room.szcWins[p2] || 0;

        setTimeout(() => {
            // Match Won (First to 3 Wins)
            if (p1Wins >= 3 || p2Wins >= 3) {
                const matchWinner = p1Wins >= 3 ? p1 : p2;
                const matchLoser = matchWinner === p1 ? p2 : p1;

                // Award 250 points flat to champion
                if (room.gameScores && room.gameScores[matchWinner]) {
                    // Only award if human player didn't abandon
                    if (!room.gameScores[matchWinner].hasLeft) {
                        room.gameScores[matchWinner].score = 250;
                    }
                }
                if (room.gameScores && room.gameScores[matchLoser]) {
                    room.gameScores[matchLoser].score = 0;
                }

                // Conclude match
                const { executeIntermissionHalt } = require('../gameCore');
                room.currentRound = room.maxRounds + 1; // Forces gameCore match conclude
                executeIntermissionHalt(roomId);
                return;
            }

            // If it's a tie, DO NOT increment round count, replay same round!
            if (resultForP1 === 'tie') {
                room.szcChoices = {};
                room.matchClock = 30;
                io.to(roomId).emit('szc_round_start', {
                    round: room.currentRound,
                    maxRounds: room.maxRounds,
                    isRetry: true
                });
                const { startRoomTimer } = require('../gameCore');
                // Restart 30s ticker
                this.startSZCTurnTicker(io, roomId, room);
            } else {
                // Round won, advance to next round!
                const { executeIntermissionHalt } = require('../gameCore');
                executeIntermissionHalt(roomId);
            }
        }, 2800);
    },

    startSZCTurnTicker(io, roomId, room) {
        if (room.interval) clearInterval(room.interval);
        room.interval = setInterval(() => {
            if (!room || room.status !== 'started') {
                clearInterval(room.interval);
                return;
            }
            room.matchClock -= 1;
            io.to(roomId).emit('szc_timer_tick', { time: Math.max(0, room.matchClock) });
            if (room.matchClock <= 0) {
                clearInterval(room.interval);
                this.handleTimeoutAutoPick(io, roomId, room);
            }
        }, 1000);
    },

    // Handles opponent leaving mid-game: activates Bot takeover
    checkRoundCompletionAfterLeave(io, roomId, room) {
        if (!room || room.status !== 'started') return;

        const players = room.initialPlayers || room.players;
        const activeHumanPlayers = players.filter(p => {
            const pProfile = room.gameScores ? room.gameScores[p] : null;
            return pProfile && !pProfile.hasLeft && !pProfile.isDisconnected;
        });

        // If both left, room is terminated by socketHandler
        if (activeHumanPlayers.length === 0) return;

        // If one player remains, bot steps in to finish the match
        if (activeHumanPlayers.length === 1) {
            io.to(roomId).emit('chat_message', {
                sender: "SYSTEM",
                text: "Opponent left. Bot will play remaining turns.",
                type: 'default'
            });
            this.checkBothPlayersLocked(io, roomId, room);
        }
    },

    processPlayerGuessSubmission() {
        // Not used in RPS (RPS uses szc_submit_choice event)
    }
};