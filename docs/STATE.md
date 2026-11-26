# State

- **Profile:** product
- **Last verified:** 2026-11-26 @ a3f466a
- **Overall status:** working

Current truth only. History belongs in [WORKLOG.md](WORKLOG.md); rationale belongs in [DECISIONS.md](DECISIONS.md). This file is the current truth for the public source release.

## Works

- The public repository exists at https://github.com/qusielh/Mrivia-Public and is visible as "PUBLIC". Verified on 2026-11-26 with "gh repo view qusielh/Mrivia-Public --json nameWithOwner,visibility,defaultBranchRef,url".
- The remote default branch is "main" and points to `a3f466aef6a226e5255b59a3de83f06d0f9612d6`. Verified on 2026-11-26 with `git ls-remote --heads origin`.
- Tag `v1.0.0` is pushed and resolves to commit `a3f466aef6a226e5255b59a3de83f06d0f9612d6`. Verified on 2026-11-26 with `git ls-remote --tags origin`.
- All 97 local commits are present in the published history. Verified on 2026-11-26 with `git rev-list --count main`, which returned `97`.
- No temporary public branches remain. Verified on 2026-11-26 with `git ls-remote --heads origin`, which returned only "refs/heads/main".
- The tracked tree was checked before publication and contained no personal data, secrets, admin surfaces, donation or Web3 content, or private links. Verified on 2026-11-26 by the sanitizer result `RESULT: CLEAN`.
- Root and mode JavaScript files passed syntax checks before publication. Verified on 2026-11-26 with `node --check` over root JavaScript files and `modes/*.js`.
- The backend requires environment variables and contains no fallback secret values. Verified by inspecting `config.js`, `server.js`, and `env.example`.

## Broken / known issues

- The package script `npm test` exits with status 1 because no automated test suite is configured. This is a deliberate gap, not a runtime failure. It is recorded in [DEVNOTES.md](DEVNOTES.md) as a follow-up.
- The server was not exercised against a live libSQL-compatible database during this session. Runtime database behavior is therefore not verified here; only syntax and configuration shape were checked.
- The real database token from the original private repository still needs to be revoked or rotated by the owner. This public repository does not contain that token, but the private history does.

## In progress

- None. The publishing task is complete at commit `4230aa1`.

## Next actions

1. Review the public repository visually and confirm the files and README look correct.
2. Revoke or rotate the real database token outside this repository.
3. Add an automated test suite before changing game behavior again.

## Risks and constraints

- GitHub publishing was performed over HTTPS because SSH port 22 timed out in this environment.
- A single commit in the history adds roughly 36.7 MB of image assets. This made ordinary HTTP pushes unreliable and required the object-creation approach recorded in [DECISIONS.md](DECISIONS.md).
- The original private repository must never be pushed or renamed into this public repository.

## Known inconsistencies

- None. The README, state, release record, and repository contents agree at commit `4230aa1`.

## Resume here

- **Read first:** [INDEX.md](INDEX.md), then this file, then [handoffs/2026-11-26-0657.md](handoffs/2026-11-26-0657.md).
- **Next command:** `git status -sb`, `git ls-remote --heads origin`, then `git ls-remote --tags origin`.
- **Blocked by:** nothing.

Return to [INDEX.md](INDEX.md).
