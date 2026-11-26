# Decisions

Append-only. One entry per decision. Supersede, never delete. Return to [INDEX.md](INDEX.md).

## ADR-0001 - Publish a separate sanitized repository

- **Date:** 2026-11-26
- **Status:** accepted
- **Supersedes:** none
- **Context:** the original project repository contained personal pages, private links, community-only data, donation and Web3 content, admin functions, and real backend credentials in its history. The user wanted to share only the games and the raw website.
- **Options considered:**

  1. Make the original repository public after deleting sensitive files - pros: keeps one repository; cons: history would still expose secrets, and rewriting shared history is risky. Cost: unacceptable privacy risk.
  2. Create a new clean repository with a fresh single commit - pros: simple; cons: loses the 92-commit progress history the user wanted to preserve. Cost: loss of history.
  3. Create a separate repository from a fully rewritten history - pros: preserves progress while removing sensitive content from trees, messages, and metadata; cons: requires careful verification. Cost: one-time verification work.

- **Decision:** option 3. The clean repository at "C:\Users\Qusie\Desktop\Mrivia-Public" was created from rewritten history and published as "qusielh/Mrivia-Public".
- **Why:** it is the only option that satisfies both constraints: nothing sensitive is published, and the development history remains visible.
- **Consequences:** the public and private repositories are now independent. Changes in the original private repository do not propagate automatically. The owner must still rotate the real database token that remains in private history.
- **What would change our mind:** a confirmed need to archive the original repository as-is without publishing it, or a decision that the progress history is not worth maintaining.
- **Evidence:** `git rev-list --count main` returned `97`; the sanitizer returned `RESULT: CLEAN`; `gh repo view` showed the new repository as `PUBLIC`.

## ADR-0002 - Create commit 3 objects through the GitHub API

- **Date:** 2026-11-26
- **Status:** accepted
- **Supersedes:** none
- **Context:** commit `4bbe437` adds about 36.7 MB of Sakura image assets in one commit. Ordinary `git push` failed with `HTTP 408`, then with `curl 55 Send failure: Connection was reset`, and staged sibling branches did not reduce the pack because Git push negotiation excludes objects only from remote commits that are ancestors of the pushed commit.
- **Options considered:**

  1. Increase timeouts and retry the same push - pros: no new mechanism; cons: the same large pack still had to be uploaded and had already failed repeatedly. Cost: unbounded waiting.
  2. Compress or remove the images - pros: smaller pack; cons: changes game assets and breaks visual parity. Cost: unacceptable behavior change.
  3. Use SSH transport - pros: may bypass HTTP resets; cons: port 22 timed out in this environment. Cost: unavailable.
  4. Create the exact blobs, trees, and commit through the GitHub Git Database API, point a temporary ref at the exact commit SHA, then push later commits normally - pros: preserves the exact SHA and avoids resending the large pack; cons: requires API calls and careful metadata matching. Cost: moderate one-time scripting.

- **Decision:** option 4. The assets tree, root tree, and commit object were created through the API using the exact SHAs and metadata from the local commit. A temporary ref was updated to that SHA, then commits 4 through 97 were pushed with ordinary Git.
- **Why:** Git object IDs are content-addressed, so recreating the exact tree and commit content through the API produces the same SHA. Once a remote ref points at commit 3, later pushes treat it as an ancestor and exclude its blobs automatically.
- **Consequences:** the published history is byte-identical to the local history. Temporary API-created tree objects with different SHAs exist as unreferenced objects on the server, but they are not part of `main` and do not affect the visible repository. The temporary ref was deleted after publication.
- **What would change our mind:** a working transport that can reliably upload the 36.7 MB pack in one request, or GitHub API rate limits that make the object-creation approach impractical.
- **Evidence:** API responses returned the exact expected SHAs `7b03b4679f94bc371ba726c7af387d796afc72c2`, `e90541dd0631140a4e7e2bfb1e2f42c4ac39fc91`, and `4bbe437c053cd3cc1f40500d6b0c6686fb6853d3`. All subsequent pushes succeeded, and `git ls-remote --heads origin` now shows only `main`.

Return to [INDEX.md](INDEX.md).
