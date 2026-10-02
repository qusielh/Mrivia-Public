// routes.js
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { COOKIE_SECRET, MODE_LIMITS, activeRooms, deletionTimeouts, userCache } = require('./config');
const { isProfane } = require('./profanityFilter');
const {
    Creator_blockchain_WALLET,
    getPublicProgress,
    adjustManualcommunityOffset,
    getManualcommunityOffset,
    getApprovedSupporters,
    recordcommunity,
    attachSupporterMessage,
    verifyblockchainTransaction,
    fetchLatestLiveblockchainUSDCTransaction,
    submitCommunityQuestion,
    getPublicAnsweredQnA,
    getAllcreator areaQnA,
    answerCommunityQuestion,
    deleteCommunityQuestion
} = require('./communityService');

function setupRoutes(db, io) {
    const router = express.Router();

    // 🟢 In-memory anti-replay map for solo practice
    const lastSoloWordByUser = {};

    function hashPassword(password) {
        return "PASS_" + crypto.createHmac('sha256', COOKIE_SECRET).update(password.trim()).digest('hex');
    }

    // 🛡️ Fast In-Memory Set of Active Banned Device Integer IDs
    const bannedDeviceIdsSet = new Set();

    (async () => {
        try {
            try { await db.run('ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0'); } catch (ignore) { }
            try { await db.run('ALTER TABLE users ADD COLUMN device_ban_id INTEGER DEFAULT 0'); } catch (ignore) { }
            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS banned_devices (
                        id INTEGER PRIMARY KEY,
                        username TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
            } catch (ignore) { }

            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS feedback (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL,
                        message TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
            } catch (ignore) { }

            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS reports (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        reporter_username TEXT NOT NULL,
                        target_username TEXT NOT NULL,
                        context TEXT NOT NULL,
                        image_filename TEXT NOT NULL,
                        image_size_bytes INTEGER NOT NULL,
                        image_data TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
            } catch (ignore) { }

            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS announcements (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
            } catch (ignore) { }

            const rows = await db.all('SELECT id FROM banned_devices');
            rows.forEach(r => {
                if (r && r.id) bannedDeviceIdsSet.add(parseInt(r.id));
            });
            console.log(`🛡️ Loaded ${bannedDeviceIdsSet.size} active device ban integer IDs.`);
        } catch (e) {
            console.error("Migration check error:", e);
        }
    })();

    function checkDeviceBanned(req) {
        const rawToken = req.signedCookies.mt_device_ban || req.cookies.mt_device_ban || req.headers['x-device-lock'];
        if (!rawToken) return false;

        const banId = parseInt(rawToken);
        if (isNaN(banId)) return false;

        return bannedDeviceIdsSet.has(banId);
    }

    function setDeviceBanCookie(res, banIntId) {
        res.cookie('mt_device_ban', String(banIntId), {
            path: '/',
            httpOnly: true,
            signed: true,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
        res.cookie('mt_device_ban_client', String(banIntId), {
            path: '/',
            httpOnly: false,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
    }

    function clearDeviceBanCookies(res) {
        res.clearCookie('mt_device_ban', { path: '/' });
        res.clearCookie('mt_device_ban_client', { path: '/' });
    }

    async function kickAndLockUser(username, banIntId) {
        if (!io || !username) return;
        try {
            const payload = {
                reason: "Your account and device have been restricted.",
                lockToken: String(banIntId),
                redirectUrl: `/?restricted=${banIntId}`
            };

            io.to("user_" + username).emit('force_device_lock', payload);
            io.to("user_" + username).emit('force_logout', payload);
            io.to("user_" + username).emit('redirect_to_lobby', payload);

            const sockets = await io.fetchSockets();
            sockets.forEach(s => {
                if (s.data && s.data.username === username) {
                    s.emit('force_device_lock', payload);
                    s.emit('force_logout', payload);
                    setTimeout(() => {
                        try { s.disconnect(true); } catch (e) { }
                    }, 50);
                }
            });
        } catch (err) {
            console.error("Socket kick error:", err);
        }
    }

    // 🟢 FAST IN-MEMORY AUTH: 0ms RAM lookup when user is cached
    const requireAuth = async (req, res, next) => {
        const rawUserId = req.signedCookies.mt_user_id;
        const userId = rawUserId ? Number(rawUserId) : null;
        if (!userId || isNaN(userId)) return res.redirect('/');

        if (userCache[userId]) {
            return next();
        }

        try {
            const user = await db.get('SELECT username, is_suspended, device_ban_id FROM users WHERE id = ?', [userId]);
            if (!user) {
                res.clearCookie('mt_user_id', { path: '/' });
                res.clearCookie('mt_room_id', { path: '/' });
                return res.redirect('/');
            }

            if (user.username !== 'Creator' && user.is_suspended) {
                res.clearCookie('mt_user_id', { path: '/' });
                res.clearCookie('mt_room_id', { path: '/' });
                return res.redirect('/');
            }

            userCache[userId] = user.username;
            next();
        } catch (e) {
            res.clearCookie('mt_user_id', { path: '/' });
            res.clearCookie('mt_room_id', { path: '/' });
            return res.redirect('/');
        }
    };

    const requireGuest = (req, res, next) => {
        if (req.signedCookies.mt_user_id) return res.redirect('/lobby.html');
        next();
    };

    const requireCreator = async (req, res, next) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.redirect('/lobby.html');

            if (userCache[userId] === 'Creator') {
                return next();
            }

            const user = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
            if (!user || user.username !== 'Creator') {
                return res.redirect('/lobby.html');
            }
            userCache[userId] = user.username;
            next();
        } catch (e) {
            return res.redirect('/lobby.html');
        }
    };

    router.get('/', (req, res) => {
        const queryRestrictedId = parseInt(req.query.restricted);
        if (!isNaN(queryRestrictedId) && bannedDeviceIdsSet.has(queryRestrictedId)) {
            setDeviceBanCookie(res, queryRestrictedId);
        } else if (!checkDeviceBanned(req)) {
            clearDeviceBanCookies(res);
        }

        if (req.signedCookies.mt_user_id && !checkDeviceBanned(req)) {
            return res.redirect('/lobby.html');
        }
        res.sendFile(path.resolve(__dirname, 'index.html'));
    });

    router.get('/lobby.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'lobby.html')); });
    router.get('/queue.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'queue.html')); });
    router.get('/Mrivia.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'Mrivia.html')); });
    router.get('/Pixelary.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'Pixelary.html')); });
    router.get('/Recipe.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'Recipe.html')); });
    router.get('/Minele.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'Minele.html')); });
    router.get('/SZC.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'SZC.html')); });
    router.get('/solo.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'solo.html')); });
    router.get('/About%20me.html', (req, res) => { res.sendFile(path.resolve(__dirname, 'project-information.html')); });
    router.get('/removed-admin.html', requireCreator, (req, res) => { res.sendFile(path.resolve(__dirname, 'removed-admin.html')); });

    // 🍔 For community Route
    router.get('/letter%20to%20community.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'removed-page.html')); });
    router.get('/removed-page.html', requireAuth, (req, res) => { res.sendFile(path.resolve(__dirname, 'removed-page.html')); });

    // 🟢 MATCHMAKING JOIN: Fast RAM Lookup with Turso fallback
    router.post('/api/matchmaking/join', async (req, res) => {
        const rawUserId = req.signedCookies.mt_user_id;
        const userId = rawUserId ? Number(rawUserId) : null;
        if (!userId || isNaN(userId)) {
            return res.status(401).json({ error: "Unauthorized session" });
        }

        let username = userCache[userId];
        if (!username) {
            const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || (user.username !== 'Creator' && user.is_suspended)) {
                res.clearCookie('mt_user_id', { path: '/' });
                return res.status(401).json({ error: "Access restricted." });
            }
            username = user.username;
            userCache[userId] = username;
        }

        const { mode } = req.body;
        const modeId = (mode !== undefined) ? parseInt(mode) : 0;
        const maxPlayers = MODE_LIMITS[modeId] || 6;

        let targetRoomId = Object.keys(activeRooms).find(id =>
            !activeRooms[id].isCustom &&
            activeRooms[id].mode === modeId &&
            activeRooms[id].players.length < maxPlayers &&
            activeRooms[id].status === 'waiting'
        );

        let action = "JOINED_EXISTING";

        if (!targetRoomId) {
            targetRoomId = crypto.randomBytes(8).toString('hex');
            activeRooms[targetRoomId] = {
                players: [],
                timer: 120,
                interval: null,
                mode: modeId,
                maxPlayers: maxPlayers,
                status: 'waiting',
                isCustom: false
            };
            action = "CREATED_NEW";
        }

        console.log(`🎮 [Matchmaking] User "${username}" assigned to Room [${targetRoomId}] (${action}, Mode: ${modeId}, Cap: ${maxPlayers})`);

        res.cookie('mt_room_id', targetRoomId, {
            path: '/',
            httpOnly: true,
            signed: true,
            maxAge: 1000 * 60 * 30,
            sameSite: 'lax'
        });

        // 🟢 MODE 4 (SZC) BYPASSES queue.html DIRECTLY TO SZC.html
        const destination = (modeId === 4) ? 'SZC.html' : 'queue.html';
        return res.json({ success: true, action: action, redirectUrl: destination });
    });

    // 🟢 CREATE CUSTOM ROOM
    router.post('/api/rooms/create', async (req, res) => {
        const rawUserId = req.signedCookies.mt_user_id;
        const userId = rawUserId ? Number(rawUserId) : null;
        if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

        let username = userCache[userId];
        if (!username) {
            const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || (user.username !== 'Creator' && user.is_suspended)) {
                res.clearCookie('mt_user_id', { path: '/' });
                return res.status(401).json({ error: "Access restricted." });
            }
            username = user.username;
            userCache[userId] = username;
        }

        const { mode } = req.body;
        const modeId = (mode !== undefined) ? parseInt(mode) : 0;
        const maxPlayers = MODE_LIMITS[modeId] || 6;

        let roomCode;
        do {
            roomCode = "SAKURA-" + Math.floor(1000 + Math.random() * 9000);
        } while (activeRooms[roomCode]);

        activeRooms[roomCode] = {
            players: [],
            timer: 120,
            interval: null,
            mode: modeId,
            maxPlayers: maxPlayers,
            status: 'waiting',
            isCustom: true
        };

        setTimeout(() => {
            if (activeRooms[roomCode] && activeRooms[roomCode].players.length === 0) {
                delete activeRooms[roomCode];
                console.log(`🧹 [Auto-Cleaner] Orphaned Custom Room [${roomCode}] erased.`);
            }
        }, 10 * 60 * 1000);

        console.log(`🌸 [Custom Room] Created Room Code [${roomCode}] by "${username}" (Mode: ${modeId}, Cap: ${maxPlayers})`);

        res.cookie('mt_room_id', roomCode, {
            path: '/',
            httpOnly: true,
            signed: true,
            maxAge: 1000 * 60 * 30,
            sameSite: 'lax'
        });

        // 🟢 MODE 4 (SZC) BYPASSES queue.html DIRECTLY TO SZC.html
        const destination = (modeId === 4) ? 'SZC.html' : 'queue.html';
        return res.json({ success: true, roomCode: roomCode, redirectUrl: destination });
    });

    // 🟢 JOIN CUSTOM ROOM
    router.post('/api/rooms/join', async (req, res) => {
        const rawUserId = req.signedCookies.mt_user_id;
        const userId = rawUserId ? Number(rawUserId) : null;
        if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

        let username = userCache[userId];
        if (!username) {
            const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || (user.username !== 'Creator' && user.is_suspended)) {
                res.clearCookie('mt_user_id', { path: '/' });
                return res.status(401).json({ error: "Access restricted." });
            }
            username = user.username;
            userCache[userId] = username;
        }

        const { roomCode } = req.body;
        const cleanCode = roomCode ? roomCode.trim().toUpperCase() : "";

        if (!activeRooms[cleanCode]) {
            return res.status(404).json({ success: false, message: "Room code not found or expired." });
        }

        const targetRoom = activeRooms[cleanCode];

        if (targetRoom.status !== 'waiting') {
            return res.status(403).json({ success: false, message: "This match has already started!" });
        }

        if (targetRoom.players && targetRoom.players.length >= targetRoom.maxPlayers) {
            return res.status(403).json({ success: false, message: "This room is already full!" });
        }

        res.cookie('mt_room_id', cleanCode, {
            path: '/',
            httpOnly: true,
            signed: true,
            maxAge: 1000 * 60 * 30,
            sameSite: 'lax'
        });

        // 🟢 MODE 4 (SZC) BYPASSES queue.html DIRECTLY TO SZC.html
        const destination = (targetRoom.mode === 4) ? 'SZC.html' : 'queue.html';
        return res.json({ success: true, roomCode: cleanCode, redirectUrl: destination });
    });

    router.post('/api/auth/check-or-register', async (req, res) => {
        try {
            if (checkDeviceBanned(req)) {
                return res.status(403).json({ error: "This device has been restricted from creating accounts." });
            } else {
                clearDeviceBanCookies(res);
            }

            const { username, customPassword } = req.body;
            if (!username) return res.status(400).json({ error: "Username required" });

            const trimmedName = username.trim();

            if (isProfane(trimmedName, true)) {
                return res.status(400).json({ error: "Username contains inappropriate language." });
            }

            const usernameRegex = /^[a-zA-Z0-9_]{3,16}$/;
            if (!usernameRegex.test(trimmedName)) {
                return res.status(400).json({ error: "Usernames can only contain letters, numbers, and underscores (3-16 characters)." });
            }

            const user = await db.get('SELECT * FROM users WHERE username = ?', [trimmedName]);

            if (user) return res.json({ exists: true });

            let credentialToStore = "";
            let generatedKeyToReturn = null;

            if (customPassword && customPassword.trim().length > 0) {
                credentialToStore = hashPassword(customPassword);
            } else {
                const secureRandomBits = crypto.randomBytes(12).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                generatedKeyToReturn = `MINE_${secureRandomBits.substring(0, 18)}`;
                credentialToStore = generatedKeyToReturn;
            }

            const result = await db.run(
                'INSERT INTO users (username, secret_key, score, is_suspended, device_ban_id) VALUES (?, ?, ?, 0, 0)',
                [trimmedName, credentialToStore, 0]
            );
            const userId = result.lastID;

            userCache[userId] = trimmedName;

            res.cookie('mt_user_id', userId.toString(), {
                path: '/',
                httpOnly: true,
                signed: true,
                maxAge: 1000 * 60 * 60 * 24 * 7,
                sameSite: 'lax',
            });

            return res.json({
                exists: false,
                secretKey: generatedKeyToReturn,
                isCustomPassword: !generatedKeyToReturn
            });
        } catch (error) {
            console.error("Registration error:", error);
            return res.status(500).json({ error: "Server registration error" });
        }
    });

    // 🟢 BULLETPROOF LOGIN: Eliminates Pass-the-Hash vulnerability
    router.post('/api/auth/login', async (req, res) => {
        try {
            const { username, secretKey } = req.body;
            const cleanUser = username ? username.trim() : "";
            const cleanKey = secretKey ? secretKey.trim() : "";

            let user;
            if (cleanKey.startsWith('MINE_')) {
                user = await db.get(
                    'SELECT id, username, score, is_suspended, device_ban_id FROM users WHERE username = ? AND secret_key = ?',
                    [cleanUser, cleanKey]
                );
            } else {
                const hashedInput = hashPassword(cleanKey);
                user = await db.get(
                    'SELECT id, username, score, is_suspended, device_ban_id FROM users WHERE username = ? AND secret_key = ?',
                    [cleanUser, hashedInput]
                );
            }

            if (user) {
                if (user.username !== 'Creator' && user.is_suspended) {
                    if (user.device_ban_id) setDeviceBanCookie(res, user.device_ban_id);
                    return res.status(403).json({ success: false, message: "This account has been temporarily suspended." });
                }

                if (!checkDeviceBanned(req)) {
                    clearDeviceBanCookies(res);
                }

                userCache[user.id] = user.username;

                res.cookie('mt_user_id', user.id.toString(), {
                    path: '/',
                    httpOnly: true,
                    signed: true,
                    maxAge: 1000 * 60 * 60 * 24 * 7,
                    sameSite: 'lax',
                });
                return res.json({ success: true, user: { username: user.username, score: user.score } });
            }
            return res.json({ success: false, message: "Incorrect password or secret key." });
        } catch (error) {
            return res.status(500).json({ error: "Server login error" });
        }
    });

    router.post('/api/auth/logout', (req, res) => {
        const rawUserId = req.signedCookies.mt_user_id;
        if (rawUserId) delete userCache[Number(rawUserId)];
        res.clearCookie('mt_user_id', { path: '/' });
        res.clearCookie('mt_room_id', { path: '/' });
        return res.json({ success: true, message: "Logged out cleanly" });
    });

    // 🟢 PLAYER IN-LOBBY PASSWORD UPDATE
    router.post('/api/user/change-password', requireAuth, async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

            const { newPassword } = req.body;
            if (!newPassword || newPassword.trim().length < 3) {
                return res.status(400).json({ error: "Password must be at least 3 characters." });
            }

            const hashed = hashPassword(newPassword.trim());
            await db.run('UPDATE users SET secret_key = ? WHERE id = ?', [hashed, userId]);

            console.log(`🔑 [Security] User ID #${userId} updated their password in lobby.`);
            return res.json({ success: true, message: "Password updated successfully! 🌸" });
        } catch (err) {
            console.error("Change password error:", err);
            return res.status(500).json({ error: "Server error changing password." });
        }
    });

    // 🟢 ADMIN MANUAL PASSWORD OVERRIDE
    router.post('/api/admin/set-user-password', requireCreator, async (req, res) => {
        try {
            const { username, newPassword } = req.body;
            if (!username || !newPassword || newPassword.trim().length < 3) {
                return res.status(400).json({ error: "Username and password (min 3 chars) required." });
            }

            const targetName = username.trim();
            const user = await db.get('SELECT id FROM users WHERE username = ?', [targetName]);
            if (!user) return res.status(404).json({ error: "User not found." });

            const hashed = hashPassword(newPassword.trim());
            await db.run('UPDATE users SET secret_key = ? WHERE id = ?', [hashed, user.id]);

            console.log(`🔑 [creator area Admin] Creator manually set new password for "${targetName}".`);
            return res.json({ success: true, message: `Password for ${targetName} updated! 🌸` });
        } catch (err) {
            console.error("Admin set password error:", err);
            return res.status(500).json({ error: "Failed to update user password." });
        }
    });

    router.get('/api/user/profile', async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

            if (userCache[userId]) {
                return res.json({ username: userCache[userId] });
            }

            const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || (user.username !== 'Creator' && user.is_suspended)) {
                res.clearCookie('mt_user_id', { path: '/' });
                res.clearCookie('mt_room_id', { path: '/' });
                return res.status(401).json({ error: "Account suspended or not found" });
            }

            userCache[userId] = user.username;
            return res.json({ username: user.username });
        } catch (error) {
            return res.status(500).json({ error: "Database error" });
        }
    });

    // 🟢 SPEEDRUN-FRIENDLY SCORE UPDATE
    router.post('/api/score/update', async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

            const user = await db.get('SELECT is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || user.is_suspended) {
                res.clearCookie('mt_user_id', { path: '/' });
                return res.status(401).json({ error: "Access restricted." });
            }

            const { pointsToAdd, word } = req.body;
            const points = parseInt(pointsToAdd);

            if (isNaN(points) || points <= 0 || points > 3000) {
                return res.status(400).json({ error: "Invalid points payload." });
            }

            if (word && typeof word === 'string') {
                const cleanWord = word.trim().toUpperCase();
                if (lastSoloWordByUser[userId] === cleanWord) {
                    return res.status(400).json({ error: "Points already claimed for this word." });
                }
                lastSoloWordByUser[userId] = cleanWord;
            }

            await db.run('UPDATE users SET score = score + ? WHERE id = ? AND is_suspended = 0', [points, userId]);
            return res.json({ success: true, message: "Score updated" });
        } catch (error) {
            return res.status(500).json({ error: "Database update error" });
        }
    });

    router.get('/api/leaderboard', async (req, res) => {
        try {
            const topPlayers = await db.all('SELECT username, score FROM users WHERE is_suspended = 0 ORDER BY score DESC, id ASC LIMIT 10');
            return res.json(topPlayers);
        } catch (error) {
            return res.status(500).json({ error: "Could not fetch leaderboard" });
        }
    });

    router.get('/api/user/rank', async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

            const data = await db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE score > u.score AND is_suspended = 0) + 1 AS rank,
                    (SELECT COUNT(*) FROM users WHERE score = u.score AND is_suspended = 0) AS tied_count,
                    score
                FROM users u WHERE id = ? AND is_suspended = 0`, [userId]);
            return res.json(data);
        } catch (error) {
            return res.status(500).json({ error: "Rank processing error" });
        }
    });

    router.post('/api/user/report', async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Please sign in to submit a report." });

            let reporterUsername = userCache[userId];
            if (!reporterUsername) {
                const reporter = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
                if (!reporter) return res.status(401).json({ error: "Reporter account not found." });
                reporterUsername = reporter.username;
            }

            const { targetUsername, context, screenshotBase64 } = req.body;
            if (!targetUsername || !targetUsername.trim()) {
                return res.status(400).json({ error: "Target player username is required." });
            }
            if (!context || !context.trim()) {
                return res.status(400).json({ error: "Explanation context is required." });
            }
            if (!screenshotBase64 || !screenshotBase64.startsWith('data:image/')) {
                return res.status(400).json({ error: "A clear screenshot image is required." });
            }

            const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
            const imageSizeBytes = Math.round((base64Data.length * 3) / 4);

            if (imageSizeBytes > 5 * 1024 * 1024) {
                return res.status(400).json({ error: "Screenshot exceeds 5MB size limit." });
            }

            const filename = `rep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;

            await db.run(
                'INSERT INTO reports (reporter_username, target_username, context, image_filename, image_size_bytes, image_data) VALUES (?, ?, ?, ?, ?, ?)',
                [reporterUsername, targetUsername.trim(), context.trim(), filename, imageSizeBytes, screenshotBase64]
            );

            console.log(`🚨 [Report Saved in Turso] ${targetUsername} reported by ${reporterUsername}`);
            return res.json({ success: true, message: "Report successfully submitted to moderation! 🌸" });
        } catch (err) {
            console.error("Report processing error:", err);
            return res.status(500).json({ error: "Server error while saving report." });
        }
    });

    router.post('/api/user/feedback', async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Please sign in to send feedback." });

            let username = userCache[userId];
            if (!username) {
                const user = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
                if (!user) return res.status(401).json({ error: "User session not found." });
                username = user.username;
            }

            const { message } = req.body;
            if (!message || !message.trim()) {
                return res.status(400).json({ error: "Feedback message cannot be empty." });
            }

            await db.run('INSERT INTO feedback (username, message) VALUES (?, ?)', [username, message.trim()]);
            console.log(`💬 [Feedback Received] from ${username}`);
            return res.json({ success: true, message: "Feedback sent! Thank you for helping improve Mrivia! 🌸" });
        } catch (err) {
            console.error("Feedback error:", err);
            return res.status(500).json({ error: "Could not save feedback." });
        }
    });

    // ==========================================
    // 📬 ANNOUNCEMENTS & PLAYER INBOX APIS
    // ==========================================

    // 🟢 Light endpoint: Only returns titles and dates (latest first)
    router.get('/api/inbox/titles', async (req, res) => {
        try {
            const list = await db.all('SELECT id, title, created_at FROM announcements ORDER BY id DESC LIMIT 50');
            return res.json(list || []);
        } catch (err) {
            console.error("Error reading inbox titles:", err);
            return res.status(500).json([]);
        }
    });

    // 🟢 On-Demand endpoint: Fetches full text only when player taps a title
    router.get('/api/inbox/message/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid announcement ID." });

            const msg = await db.get('SELECT id, title, content, created_at FROM announcements WHERE id = ?', [id]);
            if (!msg) return res.status(404).json({ error: "Announcement not found." });

            return res.json(msg);
        } catch (err) {
            console.error("Error fetching announcement body:", err);
            return res.status(500).json({ error: "Server error loading announcement." });
        }
    });

    // 🛡️ Admin endpoints (requireCreator)
    router.get('/api/admin/inbox/all', requireCreator, async (req, res) => {
        try {
            const list = await db.all('SELECT id, title, content, created_at, updated_at FROM announcements ORDER BY id DESC LIMIT 50');
            return res.json(list || []);
        } catch (err) {
            return res.status(500).json([]);
        }
    });

    router.post('/api/admin/inbox/create', requireCreator, async (req, res) => {
        try {
            const { title, content } = req.body;
            if (!title || !title.trim() || !content || !content.trim()) {
                return res.status(400).json({ error: "Title and content are required." });
            }

            await db.run('INSERT INTO announcements (title, content) VALUES (?, ?)', [title.trim(), content.trim()]);
            console.log(`📢 [creator area] Created announcement: "${title.trim()}"`);
            return res.json({ success: true, message: "Announcement published to player inbox! 🌸" });
        } catch (err) {
            console.error("Error creating announcement:", err);
            return res.status(500).json({ error: "Failed to publish announcement." });
        }
    });

    router.post('/api/admin/inbox/update', requireCreator, async (req, res) => {
        try {
            const { id, title, content } = req.body;
            const numId = Number(id);
            if (!numId || isNaN(numId) || !title || !title.trim() || !content || !content.trim()) {
                return res.status(400).json({ error: "Valid ID, title, and content required." });
            }

            await db.run('UPDATE announcements SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title.trim(), content.trim(), numId]);
            console.log(`📢 [creator area] Updated announcement ID #${numId}`);
            return res.json({ success: true, message: "Announcement updated! 🌸" });
        } catch (err) {
            console.error("Error updating announcement:", err);
            return res.status(500).json({ error: "Failed to update announcement." });
        }
    });

    router.post('/api/admin/inbox/delete', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            const numId = Number(id);
            if (!numId || isNaN(numId)) return res.status(400).json({ error: "Valid announcement ID required." });

            await db.run('DELETE FROM announcements WHERE id = ?', [numId]);
            console.log(`📢 [creator area] Deleted announcement ID #${numId}`);
            return res.json({ success: true, message: "Announcement deleted from inbox." });
        } catch (err) {
            console.error("Error deleting announcement:", err);
            return res.status(500).json({ error: "Failed to delete announcement." });
        }
    });

    // 🛡️ ADMIN creator area APIS
    router.get('/api/admin/inspect-user', requireCreator, async (req, res) => {
        try {
            const { username } = req.query;
            if (!username) return res.status(400).json({ error: "Username required" });

            const targetName = username.trim();
            const user = await db.get('SELECT id, username, score, is_suspended, device_ban_id FROM users WHERE username = ?', [targetName]);

            if (!user) {
                return res.status(404).json({ error: `Account "${targetName}" not found.` });
            }

            return res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    score: user.score,
                    isSuspended: !!user.is_suspended,
                    deviceBanId: user.device_ban_id || 0
                }
            });
        } catch (e) {
            return res.status(500).json({ error: "Database inspect error" });
        }
    });

    router.post('/api/admin/ban-user', requireCreator, async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) return res.status(400).json({ error: "Username required" });

            const targetName = username.trim();
            if (targetName === 'Creator') {
                return res.status(400).json({ error: "Cannot purge the creator area administrator." });
            }

            const user = await db.get('SELECT id, username FROM users WHERE username = ?', [targetName]);
            if (!user) return res.status(404).json({ error: "User not found" });

            const banIntId = Math.floor(100000 + Math.random() * 900000);
            bannedDeviceIdsSet.add(banIntId);
            await db.run('INSERT OR IGNORE INTO banned_devices (id, username) VALUES (?, ?)', [banIntId, user.username]);

            await kickAndLockUser(user.username, banIntId);
            await db.run('DELETE FROM users WHERE id = ?', [user.id]);
            delete userCache[user.id];

            console.log(`🚨 [creator area] User [${user.username}] purged. Banned device ID: ${banIntId}`);
            return res.json({ success: true, message: `User ${user.username} purged. Device ID: ${banIntId}` });
        } catch (error) {
            return res.status(500).json({ error: "Purge error" });
        }
    });

    router.post('/api/admin/suspend-user', requireCreator, async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) return res.status(400).json({ error: "Username required" });

            const targetName = username.trim();
            if (targetName === 'Creator') {
                return res.status(400).json({ error: "Cannot suspend the creator area administrator." });
            }

            const user = await db.get('SELECT id, username FROM users WHERE username = ?', [targetName]);
            if (!user) return res.status(404).json({ error: "User not found" });

            const banIntId = Math.floor(100000 + Math.random() * 900000);
            bannedDeviceIdsSet.add(banIntId);
            await db.run('INSERT OR IGNORE INTO banned_devices (id, username) VALUES (?, ?)', [banIntId, user.username]);

            await db.run('UPDATE users SET is_suspended = 1, device_ban_id = ? WHERE id = ?', [banIntId, user.id]);
            delete userCache[user.id];

            await kickAndLockUser(user.username, banIntId);

            console.log(`⏸️ [creator area] User [${user.username}] suspended. Banned device ID: ${banIntId}`);
            return res.json({ success: true, message: `User ${user.username} suspended. Device ID: ${banIntId}` });
        } catch (error) {
            return res.status(500).json({ error: "Suspend error" });
        }
    });

    router.post('/api/admin/unsuspend-user', requireCreator, async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) return res.status(400).json({ error: "Username required" });

            const targetName = username.trim();
            const user = await db.get('SELECT id, username, device_ban_id FROM users WHERE username = ?', [targetName]);
            if (!user) return res.status(404).json({ error: "User not found" });

            if (user.device_ban_id) {
                bannedDeviceIdsSet.delete(parseInt(user.device_ban_id));
                await db.run('DELETE FROM banned_devices WHERE id = ?', [user.device_ban_id]);
            }

            await db.run('UPDATE users SET is_suspended = 0, device_ban_id = 0 WHERE id = ?', [user.id]);
            userCache[user.id] = user.username;
            console.log(`▶️ [creator area] User [${user.username}] restored and device unbanned.`);
            return res.json({ success: true, message: `User ${user.username} restored and device unbanned.` });
        } catch (error) {
            return res.status(500).json({ error: "Unsuspend error" });
        }
    });

    router.get('/api/admin/banned-devices', requireCreator, async (req, res) => {
        try {
            const list = await db.all('SELECT id, username, created_at FROM banned_devices ORDER BY id DESC LIMIT 50');
            return res.json(list || []);
        } catch (e) {
            return res.status(500).json({ error: "Could not fetch banned devices." });
        }
    });

    router.post('/api/admin/unban-device', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            const intId = parseInt(id);
            if (!intId) return res.status(400).json({ error: "Valid device integer ID required." });

            bannedDeviceIdsSet.delete(intId);
            await db.run('DELETE FROM banned_devices WHERE id = ?', [intId]);
            await db.run('UPDATE users SET device_ban_id = 0 WHERE device_ban_id = ?', [intId]);
            console.log(`🌸 [creator area] Device integer ID [${intId}] pardoned by Creator.`);
            return res.json({ success: true, message: "Device pardoned." });
        } catch (e) {
            return res.status(500).json({ error: "Unban device error." });
        }
    });

    router.get('/api/admin/feedback', requireCreator, async (req, res) => {
        try {
            const feedbacks = await db.all('SELECT * FROM feedback ORDER BY id DESC LIMIT 50');
            return res.json(feedbacks || []);
        } catch (e) {
            return res.status(500).json({ error: "Could not fetch feedback." });
        }
    });

    router.post('/api/admin/delete-feedback', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: "Feedback ID required." });

            await db.run('DELETE FROM feedback WHERE id = ?', [id]);
            return res.json({ success: true, message: "Feedback dismissed." });
        } catch (e) {
            return res.status(500).json({ error: "Could not delete feedback." });
        }
    });

    router.get('/api/admin/reports', requireCreator, async (req, res) => {
        try {
            const reports = await db.all('SELECT * FROM reports ORDER BY id DESC LIMIT 50');
            return res.json(reports || []);
        } catch (e) {
            return res.status(500).json({ error: "Could not fetch reports." });
        }
    });

    router.get('/api/admin/report-image/:filename', requireCreator, async (req, res) => {
        const { filename } = req.params;
        const safeName = path.basename(filename);
        try {
            const report = await db.get('SELECT image_data FROM reports WHERE image_filename = ?', [safeName]);
            if (report && report.image_data && report.image_data.startsWith('data:image/')) {
                const base64Data = report.image_data.replace(/^data:image\/\w+;base64,/, '');
                const imgBuffer = Buffer.from(base64Data, 'base64');
                res.setHeader('Content-Type', 'image/jpeg');
                return res.send(imgBuffer);
            }
        } catch (e) { }
        return res.status(404).send("Screenshot not found in database.");
    });

    router.post('/api/admin/delete-report', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: "Report ID required." });

            await db.run('DELETE FROM reports WHERE id = ?', [id]);
            return res.json({ success: true, message: "Report deleted from cloud database." });
        } catch (e) {
            return res.status(500).json({ error: "Could not delete report." });
        }
    });

    // ==========================================
    // 🌸 COMMUNITY community API (Zero Dollar Leak)
    // ==========================================

    router.get('/api/communitys/progress', async (req, res) => {
        try {
            const progress = await getPublicProgress(db);
            return res.json(progress);
        } catch (err) {
            return res.status(500).json({ success: false, percentage: 0 });
        }
    });

    router.get('/api/communitys/supporters', async (req, res) => {
        try {
            const supporters = await getApprovedSupporters(db);
            return res.json(supporters);
        } catch (err) {
            return res.status(500).json([]);
        }
    });

    router.post('/api/communitys/submit-community', async (req, res) => {
        try {
            const { txHash, supporterName, message } = req.body;

            if (!txHash) {
                return res.status(400).json({ error: "Missing transaction signature" });
            }

            console.log(`🔍 [community Relay] Verifying on-chain transaction: ${txHash.substring(0, 16)}...`);

            const verifyResult = await verifyblockchainTransaction(txHash, Creator_blockchain_WALLET);

            if (!verifyResult.valid) {
                console.warn(`❌ [community Rejected] On-chain check failed: ${verifyResult.reason}`);
                return res.status(400).json({ error: `On-chain check failed: ${verifyResult.reason}` });
            }

            const verifiedAmountUsd = verifyResult.amountUsd;

            const recordResult = await recordcommunity(db, {
                txHash: txHash,
                amountUsd: verifiedAmountUsd,
                blockchain: 'blockchain',
                sender: '',
                receiver: Creator_blockchain_WALLET,
                supporterName: supporterName,
                message: message,
                verified: 1
            });

            if (!recordResult.success) {
                console.log(`ℹ️ [Notice] ${recordResult.reason}`);
                return res.status(200).json({ success: true, message: recordResult.reason });
            }

            const progress = await getPublicProgress(db);

            console.log(`💖 [community Logged & Verified] $${verifiedAmountUsd} USDC confirmed on-chain. Progress now: ${progress.percentage}%`);
            return res.json({
                success: true,
                verifiedAmount: verifiedAmountUsd,
                newPercentage: progress.percentage,
                message: "community verified on-chain and logged!"
            });

        } catch (err) {
            console.error("community relay error:", err);
            return res.status(500).json({ error: "Error processing community submission" });
        }
    });

    router.post('/api/communitys/attach-message', async (req, res) => {
        try {
            const { txHash, supporterName, message } = req.body;
            await attachSupporterMessage(db, txHash, supporterName, message);
            return res.json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: "Could not save message" });
        }
    });

    router.post('/api/communitys/webhook', async (req, res) => {
        try {
            const { transaction, blockchain, sender, receiver, payload } = req.body;

            if (!transaction) {
                return res.status(400).json({ error: "Missing transaction signature" });
            }

            console.log(`📡 [Webhook] Received community notification for TX: ${transaction.substring(0, 16)}...`);

            const verifyResult = await verifyblockchainTransaction(transaction, Creator_blockchain_WALLET);

            if (!verifyResult.valid) {
                console.warn(`❌ [Webhook Rejected] On-chain verification failed: ${verifyResult.reason}`);
                return res.status(400).json({ error: `On-chain verification rejected: ${verifyResult.reason}` });
            }

            const verifiedAmountUsd = verifyResult.amountUsd;

            let supporterName = null;
            let message = null;
            if (payload) {
                try {
                    const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
                    supporterName = parsedPayload.supporterName || null;
                    message = parsedPayload.message || null;
                } catch (e) { }
            }

            const recordResult = await recordcommunity(db, {
                txHash: transaction,
                amountUsd: verifiedAmountUsd,
                blockchain: blockchain || 'blockchain',
                sender: sender || '',
                receiver: receiver || Creator_blockchain_WALLET,
                supporterName: supporterName,
                message: message,
                verified: 1
            });

            if (!recordResult.success) {
                console.log(`⚠️ [Webhook Notice] ${recordResult.reason}`);
                return res.status(200).json({ message: recordResult.reason });
            }

            console.log(`💖 [community Confirmed & Verified On-Chain] $${verifiedAmountUsd} USDC added to ledger.`);
            return res.json({ success: true, verifiedAmount: verifiedAmountUsd, message: "community verified on-chain and logged." });

        } catch (err) {
            console.error("Webhook processing error:", err);
            return res.status(500).json({ error: "Webhook internal error" });
        }
    });

    // ==========================================
    // 🌸 COMMUNITY Q&A PUBLIC APIS
    // ==========================================

    router.get('/api/qna/public', async (req, res) => {
        try {
            const list = await getPublicAnsweredQnA(db);
            return res.json(list);
        } catch (err) {
            return res.status(500).json([]);
        }
    });

    router.post('/api/qna/ask', async (req, res) => {
        try {
            const { authorName, question } = req.body;
            if (!question || !question.trim()) {
                return res.status(400).json({ error: "Question cannot be empty" });
            }

            if (isProfane(question, false)) {
                return res.status(400).json({ error: "Question contains inappropriate language." });
            }

            const result = await submitCommunityQuestion(db, { authorName, question });
            if (result.success) {
                return res.json({ success: true, message: result.message });
            }
            return res.status(500).json({ error: result.reason });
        } catch (err) {
            return res.status(500).json({ error: "Server error submitting question" });
        }
    });

    // ==========================================
    // 🛡️ creator area ON-CHAIN TESTING, MANUAL OFFSET & Q&A
    // ==========================================

    router.post('/api/admin/communitys/adjust-offset', requireCreator, async (req, res) => {
        try {
            const { deltaAmount } = req.body;
            const numericDelta = parseFloat(deltaAmount);
            if (isNaN(numericDelta)) {
                return res.status(400).json({ error: "Valid numeric delta amount required" });
            }

            const success = await adjustManualcommunityOffset(db, numericDelta);
            if (!success) {
                return res.status(500).json({ error: "Could not adjust manual offset" });
            }

            const newOffset = await getManualcommunityOffset(db);
            const progress = await getPublicProgress(db);

            console.log(`🌸 [creator area] Manual community offset adjusted by $${numericDelta}. Current offset: $${newOffset}. New percentage: ${progress.percentage}%`);
            return res.json({
                success: true,
                adjustedBy: numericDelta,
                currentOffsetUsd: newOffset,
                newPercentage: progress.percentage,
                message: `Offset adjusted by $${numericDelta}. Total progress is now ${progress.percentage}%.`
            });
        } catch (err) {
            return res.status(500).json({ error: "Failed to adjust offset", details: err.message });
        }
    });

    router.get('/api/admin/communitys/offset', requireCreator, async (req, res) => {
        try {
            const currentOffset = await getManualcommunityOffset(db);
            return res.json({ currentOffsetUsd: currentOffset });
        } catch (err) {
            return res.status(500).json({ currentOffsetUsd: 0 });
        }
    });

    router.post('/api/admin/communitys/verify-latest-live', requireCreator, async (req, res) => {
        try {
            console.log(`🧪 [creator area 1-Click Test] Pulling latest confirmed blockchain Mainnet USDC transaction...`);
            const result = await fetchLatestLiveblockchainUSDCTransaction();
            return res.json(result);
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/api/admin/communitys/verify-onchain-test', requireCreator, async (req, res) => {
        try {
            const { txSignature } = req.body;
            if (!txSignature) return res.status(400).json({ error: "Transaction signature required" });

            console.log(`🧪 [creator area Test] Running live on-chain check for signature: ${txSignature}`);
            const result = await verifyblockchainTransaction(txSignature, Creator_blockchain_WALLET);

            return res.json({
                testedSignature: txSignature,
                verificationResult: result
            });
        } catch (err) {
            return res.status(500).json({ error: "Verification test error", details: err.message });
        }
    });

    router.post('/api/admin/communitys/reset', requireCreator, async (req, res) => {
        try {
            await db.run('DELETE FROM communitys');
            await db.run('UPDATE community_manual_offset SET offset_usd = 0 WHERE id = 1');
            return res.json({ success: true, message: "communitys reset to 0%." });
        } catch (err) {
            return res.status(500).json({ error: "Reset failed" });
        }
    });

    router.get('/api/admin/communitys/messages', requireCreator, async (req, res) => {
        try {
            const list = await db.all('SELECT id, tx_hash, supporter_name, message, is_approved, created_at FROM communitys WHERE message IS NOT NULL ORDER BY id DESC LIMIT 50');
            return res.json(list || []);
        } catch (e) {
            return res.status(500).json([]);
        }
    });

    router.post('/api/admin/communitys/delete-message', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            await db.run('UPDATE communitys SET message = NULL, is_approved = 0 WHERE id = ?', [id]);
            return res.json({ success: true, message: "Message removed from public view." });
        } catch (e) {
            return res.status(500).json({ error: "Could not remove message." });
        }
    });

    router.get('/api/admin/qna/all', requireCreator, async (req, res) => {
        try {
            const list = await getAllcreator areaQnA(db);
            return res.json(list || []);
        } catch (err) {
            return res.status(500).json([]);
        }
    });

    router.post('/api/admin/qna/answer', requireCreator, async (req, res) => {
        try {
            const { id, answer } = req.body;
            if (!id || !answer || !answer.trim()) {
                return res.status(400).json({ error: "Question ID and Answer are required." });
            }
            const success = await answerCommunityQuestion(db, { id, answer });
            if (success) {
                return res.json({ success: true, message: "Answer published to public Q&A!" });
            }
            return res.status(500).json({ error: "Failed to publish answer." });
        } catch (err) {
            return res.status(500).json({ error: "Server error answering question." });
        }
    });

    router.post('/api/admin/qna/delete', requireCreator, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: "Question ID required." });
            const success = await deleteCommunityQuestion(db, id);
            if (success) {
                return res.json({ success: true, message: "Question deleted." });
            }
            return res.status(500).json({ error: "Failed to delete question." });
        } catch (err) {
            return res.status(500).json({ error: "Server error deleting question." });
        }
    });

    return router;
}

module.exports = setupRoutes;