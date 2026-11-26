# Mrivia

A small web project with several Minecraft-themed puzzle and party games.

## Games

- **Classic Mrivia** — race other players to name the Minecraft item first.
- **Pixelary** — draw an item while other players guess what it is.
- **Recipe Guess** — identify the crafted item from its ingredients.
- **Minele** — solve a five-letter word puzzle at your own pace.
- **SZC Duel** — a 1v1 rock-paper-scissors-style mob duel.

## Lobbies

Two lobby themes are available: the Classic lobby and the Bloom lobby. Both expose the same game modes and descriptions.

The backend uses Express and Socket.IO for rooms, matchmaking, and score updates. A libSQL-compatible database stores accounts and scores.

## Run locally

Requirements:

- Node.js 18 or newer
- A libSQL-compatible database URL and auth token

Steps:

1. Install dependencies:

   ```sh
   npm install
   ```

2. Set the variables listed in `env.example` in your environment. `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, and `COOKIE_SECRET` are required.

3. Start the server:

   ```sh
   npm start
   ```

The server binds to `127.0.0.1:5000` by default. Use `HOST` and `PORT` to change the bind address and port.

## Game data

Word pools and item data live in the JSON files at the project root. Game rules and mode logic live in `gameCore.js`, `socketHandler.js`, and the `modes/` directory.

## Documentation

Project documentation starts at `docs/INDEX.md`. It covers the current state, release contents, architecture, decisions, and cleanup notes.

## Credit

Created by Qusie.

This is an unofficial fan project. It is not approved by or associated with Mojang or Microsoft.
