// server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { createClient } = require('@libsql/client');

const { COOKIE_SECRET } = require('./config');
const setupRoutes = require('./routes');
const setupSockets = require('./socketHandler');
const { initCoreEngine } = require('./gameCore');
const { initcommunityDatabase } = require('./communityService');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors());
// Body limit to easily accept up to 5MB report screenshots
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));

// Ensure local reports storage folder exists
const reportsDir = path.join(__dirname, 'reports_storage');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

// ========================================================
// 🌸 TURSO CLOUD DATABASE CLIENT & STRICT COMPATIBILITY ADAPTER
// ========================================================
const TURSO_URL = process.env.TURSO_DATABASE_URL || "libsql://database.example.invalid";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "REPLACE_WITH_DATABASE_TOKEN";

const tursoClient = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN
});

// 🟢 Bulletproof mapper: works whether Turso returns named objects or numeric arrays
function rowToObject(columns, row) {
    if (!row) return undefined;
    const obj = {};
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        obj[col] = (row[col] !== undefined) ? row[col] : (row[i] !== undefined ? row[i] : null);
    }
    return obj;
}

const db = {
    async get(sql, params = []) {
        const res = await tursoClient.execute({ sql, args: params });
        if (!res.rows || res.rows.length === 0) return undefined;
        return rowToObject(res.columns, res.rows[0]);
    },
    async all(sql, params = []) {
        const res = await tursoClient.execute({ sql, args: params });
        if (!res.rows) return [];
        return res.rows.map(row => rowToObject(res.columns, row));
    },
    async run(sql, params = []) {
        const res = await tursoClient.execute({ sql, args: params });
        return {
            lastID: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
            changes: res.rowsAffected || 0
        };
    },
    async exec(sql) {
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        for (const stmt of statements) {
            await tursoClient.execute(stmt);
        }
    }
};

(async () => {
    try {
        console.log(`📡 Connecting to Turso Cloud Database: ${TURSO_URL}...`);

        // 🟢 Verified Cloud Tables (Users, Devices, Feedback, Reports, Announcements)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                secret_key TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                is_suspended INTEGER DEFAULT 0,
                device_ban_id INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS banned_devices (
                id INTEGER PRIMARY KEY,
                username TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

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

            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS username_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                old_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                sender TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("🟢 Connected to Turso Cloud DB & Verified Tables (Users, Devices, Feedback, Reports, Announcements, Username Changes, Support Messages).");

        // 🌸 Initialize community & supporters ledger in Turso
        await initcommunityDatabase(db);

        initCoreEngine(io, db);

        // Mount routes with io instance for real-time socket kicking
        app.use('/', setupRoutes(db, io));

        app.use(express.static(path.resolve(__dirname)));

        setupSockets(io, db);

        const PORT = process.env.PORT || 5000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Mrivia Auth & Socket Server active at: http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error("🔴 Turso Cloud Database Boot Failure:", err);
    }
})();
