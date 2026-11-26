# Architecture

This document describes how the public website, game logic, and backend fit together at commit `4230aa1`. Return to [INDEX.md](INDEX.md).

## Components and responsibilities

- `server.js` is the entry point. It creates the Express server, applies HTTP middleware, loads the route table, and attaches Socket.IO.
- `routes.js` maps browser paths to the game and lobby HTML pages.
- `socketHandler.js` owns real-time rooms, matchmaking, score updates, and game event flow.
- `gameCore.js` holds shared game rules used by several modes.
- `modes/` contains the per-mode implementations. The files `modes/mode0.js` through `modes/mode3.js` correspond to the modes exposed by the lobbies.
- `config.js` reads configuration from environment variables only. It is the single boundary between deployment secrets and application code.
- The root HTML files are the browser surfaces. `index.html` is the entry page, `lobby.html` and `lobby_bloom.html` are the two lobby themes, and the remaining pages host individual games and solo variants.
- Root JSON files such as `mrivia_data.json`, `pixelary_data.json`, `minele_data.json`, and `recipe_data.json` are static game data. Folders such as `recipe_data/` and `assets/` contain images used by those pages.
- `README.md` and `env.example` describe setup and the required variables.

## Data flow

A browser first requests an HTML page through Express and `routes.js`. After the page loads, it opens a Socket.IO connection. `socketHandler.js` places the client into a room, selects a mode, and emits game events. `gameCore.js` and the selected file under `modes/` validate answers, advance rounds, and compute scores. When a score must persist, the backend writes through the libSQL-compatible client configured from `DATABASE_URL` and `DATABASE_AUTH_TOKEN`. Score updates are broadcast back to the room through Socket.IO.

## Invariants

- No secret value is present in the tracked tree. All secrets come from environment variables at runtime.
- Both lobby themes expose the same mode descriptions. The Bloom lobby uses its own presentation strings for tale, queue, and solo modes, but it does not introduce different game rules.
- Public pages do not expose admin tools, personal pages, donation flows, Web3 flows, or community-only data stores.
- Any change to a game's rules must be made in the shared core or in the matching file under `modes/`, not by editing a static data file to fake behavior.

## Failure modes

- If required environment variables are missing, the backend cannot initialize its database client. The server is expected to fail at startup rather than silently use a fallback secret.
- If a JSON game data file is malformed, the affected game cannot build its word or item pool.
- If the database is unreachable, score persistence fails while the static website may still load.
- If a Socket.IO event name changes without updating both the browser page and `socketHandler.js`, the affected game stops progressing.

## External dependencies and trust boundaries

The runtime depends on the npm packages declared in `package.json`: Express, Socket.IO, cookie-parser, cors, a libSQL client, and SQLite drivers. The database is supplied by the operator; this repository contains only the client code and empty variable names in `env.example`. The browser is treated as untrusted input, so game answers and room actions must be validated on the server.

## Security boundaries

The public repository contains no credentials and no personal information beyond the simple `Qusie` credit in `README.md` and `package.json`. Backend configuration is read from the process environment. The removed admin and personal surfaces are intentionally absent. Anyone deploying this code must provide their own database and cookie secret and must not commit them.

## Testing strategy and limits

Verification for this release was limited to syntax checks with `node --check`, JSON parsing, and repository-level sanitizer checks. There is no automated runtime test suite. Browser gameplay, live database writes, and concurrent Socket.IO rooms were not exercised in the publishing session.

Return to [INDEX.md](INDEX.md).
