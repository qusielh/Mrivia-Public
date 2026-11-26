# Worklog

Newest first. Append-only. Never rewrite history. One entry per meaningful change. Return to [INDEX.md](INDEX.md).

## 2026-11-26 - Publish sanitized public repository

- **Goal:** make the clean website and game source visible on GitHub without exposing anything private from the original project.
- **Changes:** created "qusielh/Mrivia-Public" as a public repository, pushed all 97 commits, set "main" as the default branch, removed the temporary staging branch, and added this documentation set.
- **Why:** the user wanted to share only the raw website and games. A separate public repository keeps the original private repository and its history out of the public surface.
- **Files:** `README.md`, `AGENTS.md`, `docs/INDEX.md`, `docs/STATE.md`, `docs/WORKLOG.md`, `docs/DECISIONS.md`, `docs/DEVNOTES.md`, `docs/ARCHITECTURE.md`, `docs/RELEASES.md`, `docs/handoffs/2026-11-26-0657.md`.
- **Commits:** `4230aa1` is the last published source commit; the documentation files are added in the commit that follows it.
- **Verification:** `git ls-remote --heads origin` returned only "refs/heads/main" at `4230aa181e2d0800f66aba5883ffb3fb54ea2f4a`. `gh repo view` returned visibility "PUBLIC" and default branch "main". `git rev-list --count main` returned `97`.
- **Follow-ups:** the owner must rotate the real database token in the original private repository and should review the public repository visually.
- **Source:** direct session work on 2026-11-26. [verified]

## 2026-11-26 - Repair the large first push failure

- **Goal:** publish a history whose third commit adds about 36.7 MB of image assets while keeping the commit SHA unchanged.
- **Changes:** diagnosed that normal `git push` negotiation excludes objects only when the remote tip is an ancestor of the pushed commit. Temporary sibling branches therefore did not reduce the pack. The exact tree and commit objects for commit `4bbe437` were created through the GitHub Git Database API from blobs already present on the server, a temporary ref was pointed at that exact SHA, and then commits 4 through 97 were pushed normally.
- **Why:** retrying the same large pack and increasing timeouts only hid the cause. Compressing or dropping the images would have changed the game assets and was rejected. SSH was unavailable because port 22 timed out.
- **Files:** no tracked source files were changed by this repair; only the remote repository state was changed.
- **Commits:** the repaired commit is `4bbe437c053cd3cc1f40500d6b0c6686fb6853d3`; the final published source commit is `4230aa1`.
- **Verification:** the API returned tree SHA `7b03b4679f94bc371ba726c7af387d796afc72c2` for the assets tree, tree SHA `e90541dd0631140a4e7e2bfb1e2f42c4ac39fc91` for the root tree, and commit SHA `4bbe437c053cd3cc1f40500d6b0c6686fb6853d3` for the commit. Subsequent per-commit pushes succeeded, and the remote was finally reduced to `main` only.
- **Follow-ups:** none for the repository. The diagnostic settings `http.postBuffer`, `http.lowSpeedLimit`, `http.lowSpeedTime`, and `http.version` remain local Git configuration and are not part of the tracked project.
- **Source:** direct session work on 2026-11-26. [verified]

## 2026-11-26 - Sanitize the public source tree and history [backfilled]

- **Goal:** produce a repository containing only the raw website, games, and safely isolated backend.
- **Changes:** rewrote 92 original commits with sanitized trees, messages, and metadata; added five cleanup commits; removed personal page routes, non-game APIs, community-only data stores, admin surfaces, fake community names, donation and Web3 content, and private links; replaced backend secrets with environment-only configuration.
- **Why:** the original repository contained private material that must never be published. The user asked for a separate public repository and for the progress history to remain readable.
- **Evidence:** git history ending at `4230aa1`, the clean verifier result `RESULT: CLEAN`, and the five cleanup commit subjects `26625fb`, `13dc87e`, `c7beb9d`, `50737db`, and `4230aa1`.
- **Confidence:** [verified] from git history and the recorded verifier output.

Return to [INDEX.md](INDEX.md).
