# Releases

This file records what was published. Return to [INDEX.md](INDEX.md).

## 1.0.0 - Public source release

- **Date:** 2026-11-26
- **Status:** working
- **Repository:** "qusielh/Mrivia-Public"
- **Visibility:** public
- **Default branch:** `main`
- **Published source commit:** `4230aa181e2d0800f66aba5883ffb3fb54ea2f4a`
- **Tag:** `v1.0.0`, annotated tag object `62279966e73bff42738c4971031641f98e30cefe`, resolving to commit `a3f466aef6a226e5255b59a3de83f06d0f9612d6`
- **Version source:** `package.json` declares version `1.0.0`

### Release contents

The release contains the raw website, all game pages, shared game logic, mode implementations, static game data and images, and a backend whose configuration is read only from environment variables. It preserves the original 92-commit progress history, rewritten so that trees, messages, and metadata contain no private information, followed by five cleanup commits.

The cleanup commits are:

- `26625fb` - remove personal page routes and creator exceptions.
- `13dc87e` - remove non-game APIs and community-only data stores.
- `c7beb9d` - isolate backend configuration behind environment variables.
- `50737db` - clean lobby UI and remove non-game surfaces.
- `4230aa1` - publish clean setup notes and env-only configuration.

### Verification

- `git rev-list --count main` returned `97` on 2026-11-26.
- `git ls-remote --heads origin` returned only "refs/heads/main" at `4230aa181e2d0800f66aba5883ffb3fb54ea2f4a` after cleanup.
- "gh repo view qusielh/Mrivia-Public --json nameWithOwner,visibility,defaultBranchRef,url" returned visibility "PUBLIC" and default branch "main".
- `git ls-remote --tags origin` returned tag `v1.0.0` resolving to `a3f466aef6a226e5255b59a3de83f06d0f9612d6`.
- The pre-publication sanitizer returned `RESULT: CLEAN`.
- Root and mode JavaScript files passed `node --check`; JSON files parsed successfully.

### Known issues

- `npm test` exits with status 1 because no automated test suite is configured.
- The server was not run against a live database during this session.
- The real database token in the original private repository still requires external rotation by the owner.

### Rollback

Because the repository is public, history may already have been cloned. If a published change is later found to be wrong, create a new corrective commit on `main` rather than deleting or rewriting the published history. The rollback point for the source release is `4230aa1`.

Return to [INDEX.md](INDEX.md).
