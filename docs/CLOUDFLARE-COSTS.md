# Staying on Cloudflare's free plan

Plastic is built so normal use fits Cloudflare's free allowances. Check new features against
this budget before shipping them. Limits change; confirm them on Cloudflare's pricing pages.

## Free allowances that matter (at the time of writing)

| Product | Allowance | Over the limit |
| --- | --- | --- |
| Workers | 100,000 requests/day, 10 ms CPU per request | Requests fail (no bill) |
| Static assets (the app itself) | Unlimited, and they don't run the Worker | — |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB | Queries fail (no bill) |
| Durable Objects (SQLite) | 100k requests/day; WebSocket messages count 1/20 | Requests fail (no bill) |
| **R2** | 10 GB stored, **1M Class A** (writes, lists)/month, 10M Class B (reads)/month | **Billed** (a payment method is on file) |

R2 is the only one that bills, so R2 writes and lists are the scarcest resource.

## What each action costs

| Action | Worker requests | D1 | R2 | Durable Object |
| --- | --- | --- | --- | --- |
| Open the app | 1–2 (`/api/health` is browser-cached for 10 min; session check uses the signed cookie) | 0 (cookie cache) | — | — |
| Home (file list) | 1 | 1 indexed query | 0 — thumbnails are cached by version, downloaded once | — |
| Open a file | 1 + files not yet cached | 1 row | 1 read per uncached file | 1 WebSocket connect |
| Autosave | 1 per changed file + 1 commit | 1 read + 1 write | 1 write (Class A) per changed file | 1/20 (announce over the socket) |
| Another tab receiving a change | 1 per changed file | — | 1 read per changed file | 1/20 |
| Figma import | 2 + files + images | 3 | 1 write per file and image | — |
| Idle open editor | heartbeat every 45 s | — | — | answered by the runtime without waking the room |

How the code keeps those numbers low:

- **No R2 lists on hot paths.** Each project row stores a version per file; listing and opening are D1 reads.
- **Cache forever by version.** File URLs carry `?v=<etag>` and images are named by content hash, so both are `immutable`.
- **Fewer, smaller saves.** Cloud autosave waits for a 1.5 s pause (at most 10 s), uploads only changed files, and saves at once when you leave the tab.
- **Low CPU.** File contents stream to and from R2; the Worker never parses big JSON, which keeps requests well under 10 ms.
- **Cheap live sync.** Editors announce their own saves over the WebSocket. Rooms hibernate when idle, and hidden tabs drop their connection after 5 minutes.
- **No wasted calls.** Session checks don't run on window focus, and Home re-checks the file list at most every 30 s.

## Known pressure points

- **Password sign-in/sign-up** hashes with scrypt (~100 ms CPU), above the 10 ms free limit. Cloudflare
  tolerates occasional overruns, and it only runs at sign-in. GitHub/Google sign-in avoids it entirely.
- **Open sign-up** means anyone can create an account and store files. Before wider launch, add an
  allowlist/invite codes and a per-user storage cap.
- **Big imported files**: editing `styles.css` of a large import re-uploads the whole file (R2 has no
  partial writes). That's one Class A write per save; the autosave pause keeps the count low.

## Watching usage

Cloudflare dashboard → **Workers & Pages → plastic → Metrics**, **R2 → plastic-files → Metrics**,
and **D1 → plastic → Metrics**. Set a billing notification for R2 in **Manage Account → Notifications**.
