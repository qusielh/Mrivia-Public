// routes.js
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { COOKIE_SECRET, MODE_LIMITS, activeRooms, deletionTimeouts, userCache } = require('./config');
const { isProfane } = require('./profanityFilter');
function setupRoutes(db, io) {
    const router = express.Router();

    // 🟢 In-memory anti-replay map for solo practice
    const lastSoloWordByUser = {};

    function hashPassword(password) {
        return "PASS_" + crypto.createHmac('sha256', COOKIE_SECRET).update(password.trim()).digest('hex');
    }

    // 🟢 USERNAME RULES: letters, numbers, single spaces and underscores (3-16 characters)
    const USERNAME_REGEX = /^[A-Za-z0-9_ ]{3,16}$/;
    const USERNAME_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // One username change per week

    function normalizeUsername(raw) {
        return (raw || '').toString().replace(/\s+/g, ' ').trim();
    }

    function parseDbTimestamp(value) {
        if (!value) return NaN;
        let s = String(value).trim().replace(' ', 'T');
        if (!/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
        return Date.parse(s);
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
                    CREATE TABLE IF NOT EXISTS username_changes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        old_username TEXT NOT NULL,
                        new_username TEXT NOT NULL,
                        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

            if (user.is_suspended) {
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
        if (req.signedCookies.mt_user_id) return res.redirect('/lobby');
        next();
    };

    router.get('/', (req, res) => {
        const queryRestrictedId = parseInt(req.query.restricted);
        if (!isNaN(queryRestrictedId) && bannedDeviceIdsSet.has(queryRestrictedId)) {
            setDeviceBanCookie(res, queryRestrictedId);
        } else if (!checkDeviceBanned(req)) {
            clearDeviceBanCookies(res);
        }

        if (req.signedCookies.mt_user_id && !checkDeviceBanned(req)) {
            return res.redirect('/lobby');
        }
        res.sendFile(path.resolve(__dirname, 'index.html'));
    });

    // 🌸 CLEAN URLS: pretty paths serve their page with the exact same guards as before
    const pageRoutes = [
        { url: '/lobby', file: 'lobby.html', guard: requireAuth },
        { url: '/queue', file: 'queue.html', guard: requireAuth },
        { url: '/mrivia', file: 'Mrivia.html', guard: requireAuth },
        { url: '/pixelary', file: 'Pixelary.html', guard: requireAuth },
        { url: '/recipe', file: 'Recipe.html', guard: requireAuth },
        { url: '/minele', file: 'Minele.html', guard: requireAuth },
        { url: '/minele-solo', file: 'minele_solo.html', guard: requireAuth },
        { url: '/szc', file: 'SZC.html', guard: requireAuth },
        { url: '/szc-solo', file: 'szc_solo.html', guard: requireAuth },
        { url: '/bloom', file: 'lobby_bloom.html', guard: requireAuth }
    ];

    pageRoutes.forEach(({ url, file, guard }) => {
        const handler = (req, res) => res.sendFile(path.resolve(__dirname, file));
        if (guard) router.get(url, guard, handler);
        else router.get(url, handler);
    });

    // 🔁 LEGACY: 301 the old .html URLs to the clean ones so old links/bookmarks keep working
    const legacyRedirects = {
        '/lobby.html': '/lobby',
        '/queue.html': '/queue',
        '/Mrivia.html': '/mrivia',
        '/Pixelary.html': '/pixelary',
        '/Recipe.html': '/recipe',
        '/Minele.html': '/minele',
        '/minele_solo.html': '/minele-solo',
        '/SZC.html': '/szc',
        '/szc_solo.html': '/szc-solo',
        '/lobby_bloom.html': '/bloom'
    };
    router.use((req, res, next) => {
        if (req.method !== 'GET') return next();
        let cleanPath = req.path;
        try { cleanPath = decodeURIComponent(cleanPath); } catch (e) { }
        const target = legacyRedirects[cleanPath];
        if (target) return res.redirect(301, target);
        next();
    });

    // 🟢 MATCHMAKING JOIN: Fast RAM Lookup with database fallback
    router.post('/api/matchmaking/join', async (req, res) => {
        const rawUserId = req.signedCookies.mt_user_id;
        const userId = rawUserId ? Number(rawUserId) : null;
        if (!userId || isNaN(userId)) {
            return res.status(401).json({ error: "Unauthorized session" });
        }

        let username = userCache[userId];
        if (!username) {
            const user = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [userId]);
            if (!user || user.is_suspended) {
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
        const destination = (modeId === 4) ? '/szc' : '/queue';
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
            if (!user || user.is_suspended) {
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
        const destination = (modeId === 4) ? '/szc' : '/queue';
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
            if (!user || user.is_suspended) {
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
        const destination = (targetRoom.mode === 4) ? '/szc' : '/queue';
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

            const trimmedName = normalizeUsername(username);

            if (isProfane(trimmedName, true)) {
                return res.status(400).json({ error: "Username contains inappropriate language." });
            }

            if (!USERNAME_REGEX.test(trimmedName)) {
                return res.status(400).json({ error: "Usernames can only contain letters, numbers, spaces, and underscores (3-16 characters)." });
            }

            const user = await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [trimmedName]);

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
            const cleanUser = normalizeUsername(username);
            const cleanKey = secretKey ? secretKey.trim() : "";

            let user;
            if (cleanKey.startsWith('MINE_')) {
                user = await db.get(
                    'SELECT id, username, score, is_suspended, device_ban_id FROM users WHERE LOWER(username) = LOWER(?) AND secret_key = ?',
                    [cleanUser, cleanKey]
                );
            } else {
                const hashedInput = hashPassword(cleanKey);
                user = await db.get(
                    'SELECT id, username, score, is_suspended, device_ban_id FROM users WHERE LOWER(username) = LOWER(?) AND secret_key = ?',
                    [cleanUser, hashedInput]
                );
            }

            if (user) {
                if (user.is_suspended) {
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

    // 🟢 PLAYER IN-LOBBY USERNAME UPDATE (Once per week + full audit log + history propagation)
    router.post('/api/user/change-username', requireAuth, async (req, res) => {
        try {
            const rawUserId = req.signedCookies.mt_user_id;
            const userId = rawUserId ? Number(rawUserId) : null;
            if (!userId || isNaN(userId)) return res.status(401).json({ error: "Unauthorized session" });

            const { newUsername } = req.body;
            const cleanName = normalizeUsername(newUsername);

            if (!cleanName) return res.status(400).json({ error: "Username required." });
            if (isProfane(cleanName, true)) {
                return res.status(400).json({ error: "Username contains inappropriate language." });
            }
            if (!USERNAME_REGEX.test(cleanName)) {
                return res.status(400).json({ error: "Usernames can only contain letters, numbers, spaces, and underscores (3-16 characters)." });
            }

            const me = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
            if (!me) return res.status(404).json({ error: "Account not found." });

            const oldName = me.username;

            if (cleanName.toLowerCase() === (oldName || '').toLowerCase()) {
                return res.status(400).json({ error: "That is already your username." });
            }

            // ⏳ Weekly cooldown based on the audit log (survives renames via stable user_id)
            const lastChange = await db.get(
                'SELECT changed_at FROM username_changes WHERE user_id = ? ORDER BY id DESC LIMIT 1',
                [userId]
            );
            if (lastChange && lastChange.changed_at) {
                const lastMs = parseDbTimestamp(lastChange.changed_at);
                if (!isNaN(lastMs)) {
                    const elapsed = Date.now() - lastMs;
                    if (elapsed < USERNAME_CHANGE_COOLDOWN_MS) {
                        const remain = USERNAME_CHANGE_COOLDOWN_MS - elapsed;
                        const days = Math.floor(remain / 86400000);
                        const hours = Math.floor((remain % 86400000) / 3600000);
                        const mins = Math.floor((remain % 3600000) / 60000);
                        return res.status(429).json({ error: `You can only change your username once per week. Try again in ${days}d ${hours}h ${mins}m.` });
                    }
                }
            }

            // 🛡️ Case-insensitive uniqueness (prevents lookalike impersonation)
            const taken = await db.get(
                'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?',
                [cleanName, userId]
            );
            if (taken) return res.status(409).json({ error: "That username is already taken." });

            // 💾 Apply the rename
            await db.run('UPDATE users SET username = ? WHERE id = ?', [cleanName, userId]);

            // 🔁 Propagate the new name across historical records (case-insensitive matching)
            await db.run('UPDATE banned_devices SET username = ? WHERE LOWER(username) = LOWER(?)', [cleanName, oldName]);

            // 🧾 Audit log entry (never deleted, so rename cannot hide a ban)
            await db.run(
                'INSERT INTO username_changes (user_id, old_username, new_username) VALUES (?, ?, ?)',
                [userId, oldName, cleanName]
            );

            userCache[userId] = cleanName;

            console.log(`✏️ [Security] User ID #${userId} renamed from "${oldName}" to "${cleanName}".`);
            return res.json({ success: true, message: "Username updated successfully! 🌸", username: cleanName });
        } catch (err) {
            console.error("Change username error:", err);
            return res.status(500).json({ error: "Server error changing username." });
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
            if (!user || user.is_suspended) {
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

    return router;
}

module.exports = setupRoutes;