// server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const { createClient } = require('@libsql/client');

const { COOKIE_SECRET } = require('./config');
const setupRoutes = require('./routes');
const setupSockets = require('./socketHandler');
const { initCoreEngine } = require('./gameCore');

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN;

if (!DATABASE_URL || !DATABASE_AUTH_TOKEN) {
    throw new Error('Missing DATABASE_URL or DATABASE_AUTH_TOKEN. Copy env.example to .env and fill in your own values.');
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));

// ========================================================
// DATABASE CLIENT & STRICT COMPATIBILITY ADAPTER
// ========================================================
const dbClient = createClient({
    url: DATABASE_URL,
    authToken: DATABASE_AUTH_TOKEN
});

// Maps both named and positional rows to a consistent object shape.
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
        const res = await dbClient.execute({ sql, args: params });
        if (!res.rows || res.rows.length === 0) return undefined;
        return rowToObject(res.columns, res.rows[0]);
    },
    async all(sql, params = []) {
        const res = await dbClient.execute({ sql, args: params });
        if (!res.rows) return [];
        return res.rows.map(row => rowToObject(res.columns, row));
    },
    async run(sql, params = []) {
        const res = await dbClient.execute({ sql, args: params });
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
            await dbClient.execute(stmt);
        }
    }
};

(async () => {
    try {
        console.log('📡 Connecting to database...');

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

            CREATE TABLE IF NOT EXISTS username_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                old_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('🟢 Database ready. Verified tables: users, banned_devices, username_changes.');

        initCoreEngine(io, db);
        app.use('/', setupRoutes(db, io));
        app.use(express.static(path.resolve(__dirname)));
        setupSockets(io, db);

        const HOST = process.env.HOST || '127.0.0.1';
        const PORT = process.env.PORT || 5000;
        server.listen(PORT, HOST, () => {
            console.log(`🚀 Mrivia server active at http://${HOST}:${PORT}`);
        });
    } catch (err) {
        console.error('🔴 Database boot failed:', err);
    }
})();
