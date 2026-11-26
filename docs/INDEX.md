# Mrivia - Documentation Index

- **Profile:** product
- **Status:** working
- **Last verified:** 2026-11-26 @ 4230aa1
- **Repository:** https://github.com/qusielh/Mrivia-Public
- **Audience:** players, developers, and maintainers of the public source release

## What this is

Mrivia is a small web project with several Minecraft-themed puzzle and party games. This public repository contains the raw website, the game logic, and a backend whose configuration is supplied entirely through environment variables. It was published as a separate repository so that no private accounts, tokens, personal pages, or community-only data from the original project are exposed.

## Reading order

1. `STATE.md` - what is true right now.
2. `WORKLOG.md` - what changed recently and why.
3. `DECISIONS.md` - why the current design exists.
4. `DEVNOTES.md` - experiments, bloat, and cleanup conditions.
5. `ARCHITECTURE.md` - how the website, games, and backend fit together.
6. `RELEASES.md` - what was published.
7. `README.md` - user-facing setup and usage.
8. `handoffs/2026-11-26-0657.md` - the exact state left by the publishing session.

## Document map

| Document | Purpose | Status |
|---|---|---|
| [STATE.md](STATE.md) | Current truth | working |
| [WORKLOG.md](WORKLOG.md) | Chronological history | current |
| [DECISIONS.md](DECISIONS.md) | Durable rationale | current |
| [DEVNOTES.md](DEVNOTES.md) | Experiments and cleanup | current |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Structure and data flow | current |
| [RELEASES.md](RELEASES.md) | Release record | current |
| [README.md](../README.md) | User-facing usage | current |
| [Project rules](../AGENTS.md) | Operational rules for agents | current |
| [Handoff 2026-11-26 06:57](handoffs/2026-11-26-0657.md) | Session freeze | current |

## Quick commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Start the server | `npm start` |
| Syntax check | `node --check server.js` |
| Check repository state | `git status -sb` |
| Check public remote | `git ls-remote --heads origin` |

## Current focus

The public source release is complete. The next action is for the owner to review the GitHub repository and rotate the real database token that still exists in the original private repository; the token is not present in this public repository.

## Related

- Project rules: [AGENTS.md](../AGENTS.md)
- Repository: https://github.com/qusielh/Mrivia-Public
