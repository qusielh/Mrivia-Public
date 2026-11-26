# Devnotes

Cleanup map for experiments, temporary objects, and known follow-ups. Return to [INDEX.md](INDEX.md).

## Temporary remote staging ref

- **Location:** the former remote branch `mrivia-public-stage` and the failed probe branch `mrivia-stage-b`.
- **Reason:** they were used to stage large image blobs and then to walk the 97-commit history forward when a single HTTP push failed.
- **Cleanup condition:** remove every temporary branch once `main` exists at the final commit and the default branch has been switched to `main`.
- **Status:** cleaned on 2026-11-26. `git ls-remote --heads origin` returned only "refs/heads/main" at `4230aa181e2d0800f66aba5883ffb3fb54ea2f4a`.

## Temporary local index and JSON files

- **Location:** `C:\Users\Qusie\AppData\Local\Temp\opencode\mrivia-*`.
- **Reason:** custom Git index files and API request bodies were used to construct exact tree objects for ADR-0002.
- **Cleanup condition:** delete them after the API returns the expected SHAs and the temporary ref is no longer needed.
- **Status:** cleaned on 2026-11-26. A directory listing for the `mrivia-*` pattern returned zero files.

## Unreferenced API-created tree objects

- **Location:** the remote repository object store, not tracked by any branch.
- **Reason:** one root-tree attempt used a directory mode string that GitHub accepted but that did not produce the canonical Git tree SHA. The object is harmless and unreferenced.
- **Cleanup condition:** no action required because GitHub garbage collection can remove unreferenced objects that are not part of any ref. It is recorded here so a future object-count difference is not mistaken for repository drift.
- **Status:** accepted on 2026-11-26. `main` points only to the canonical history.

## Missing automated test suite

- **Location:** `package.json` defines `npm test` as a command that exits with status 1.
- **Reason:** the original project did not include automated tests, and this release intentionally preserves the game logic without redesigning it.
- **Cleanup condition:** add a real test suite before the next behavior change in `gameCore.js`, `socketHandler.js`, or any file under `modes/`.
- **Status:** open follow-up, not an experiment. Syntax checks with `node --check` passed on 2026-11-26, but runtime behavior is not automatically verified.

Return to [INDEX.md](INDEX.md).
