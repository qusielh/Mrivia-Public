# Project Rules

Project-local instructions for the public Mrivia repository. Read the global working agreement first, then this file.

## Purpose

This repository publishes the raw Mrivia website and game logic. It must remain a clean public source release with no personal data, secrets, admin tools, donation or Web3 content, or private links. The original private repository is out of scope and must never be pushed here.

## Stack

- Language: JavaScript and HTML with static JSON data
- Runtime: Node.js 18 or newer
- Framework: Express 5 and Socket.IO 4
- Package manager: npm
- Database / storage: libSQL-compatible database configured by environment variables
- Key libraries: "@libsql/client", "cookie-parser", "cors", "sqlite", "sqlite3"

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Start the server | `npm start` |
| Syntax check | `node --check server.js` |
| Test | `npm test` currently exits 1 because no suite is configured |
| Check repository state | `git status -sb` |
| Check public remote | "git ls-remote --heads origin" |

## Conventions

- Keep game rules in `gameCore.js` or the matching file under `modes/`.
- Keep deployment values in environment variables listed in `env.example`.
- Update code, comments, `README.md`, and `docs/` in the same commit when behavior changes.
- Use absolute dates in documentation and name exact commands, paths, and commit SHAs.

## Boundaries

- Do not add personal pages, social links, biographies, donation flows, Web3 flows, admin pages, or fake community names.
- Do not commit ".env", tokens, database URLs, cookie secrets, logs, build outputs, or temporary files.
- Do not force-push `main`.
- Do not push from "C:\Users\Qusie\Desktop\Git Mrivia" to any public remote.

## Documentation map

- `docs/INDEX.md` - start here.
- `docs/STATE.md` - current truth.
- `docs/WORKLOG.md` - history.
- `docs/DECISIONS.md` - rationale.
- `docs/DEVNOTES.md` - experiments and cleanup.
- `docs/ARCHITECTURE.md` - structure and data flow.
- `docs/RELEASES.md` - releases.

## Current focus

The public source release is complete at commit `4230aa1`. The remaining external action is token rotation in the original private repository.

## Verification

Run "node --check" on changed JavaScript files, parse changed JSON files, and run "git status -sb" before committing. For publication checks, run "git ls-remote --heads origin" and "gh repo view qusielh/Mrivia-Public --json nameWithOwner,visibility,defaultBranchRef,url" and confirm that only "main" exists and visibility is "PUBLIC".
