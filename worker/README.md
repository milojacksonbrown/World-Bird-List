# Lyrebird on Cloudflare Workers

The same Lyrebird as [`Lyrebird/Lyrebird.gs`](../Lyrebird/Lyrebird.gs), the website's AI and eBird
middleman, running on Cloudflare Workers instead of Google Apps Script, because it answers much faster.

**Why move it.** Timing the live Apps Script Lyrebird showed Google taking 1.5 to 13 seconds to reply
at all, even to a remembered answer that needs no AI; the AI itself takes about 2.5 s. The slowness was
the platform, not the AI. A Worker runs on Cloudflare's network near whoever is using the site.

**What doesn't change.** Every rule is the same code, bundled unchanged from the Apps Script files:
the request checks, the prompts, the checks on the AI's answers, the replies, the daily caps, and which
model to try and when to fall back. Only the sending and storing differ:

| Apps Script | This Worker |
| --- | --- |
| Script Properties (the keys) | Cloudflare secrets |
| Script Properties (the daily counts) | D1, Cloudflare's small SQL database; one SQL statement checks and counts, so two requests can't both take the last call |
| CacheService | D1 (Cloudflare's own cache does nothing on a free `workers.dev` address) |
| UrlFetchApp | `fetch` |

The website asks the Worker first and falls back to the Apps Script Lyrebird if the Worker can't be
reached or can't reach the AI, so either one failing isn't fatal.

## Files

- `main.js`: the Worker's own part (sending, storing, who may use it).
- `dist/lyrebird.js`: what's deployed, built by `node tools/build-worker.js` from the shared Apps Script
  files plus `main.js`. A test fails if it's out of date.
- `wrangler.toml`: Cloudflare's settings (no secrets).
- Tests: [`Tests/worker.test.js`](../Tests/worker.test.js), with Node's own SQLite standing in for D1.

## Deploying (first time)

From the repo folder, in a terminal. `npx wrangler@4` runs Cloudflare's tool without installing it.

1. `cd worker`
2. `npx wrangler@4 login`, and allow access in the browser window that opens.
3. `npx wrangler@4 d1 create lyrebird`, then copy the `database_id` it prints into `wrangler.toml`.
4. `npx wrangler@4 deploy`. It prints the Worker's address, ending `.workers.dev`.
5. The keys, one at a time. Run the command **on its own**, then paste the key when it asks (it isn't
   shown, and it's never saved in a file):
   - `npx wrangler@4 secret put GROQ_API_KEY`
   - `npx wrangler@4 secret put GEMINI_API_KEY`
   - `npx wrangler@4 secret put EBIRD_API_KEY`
6. Put the Worker's address in `LYREBIRD_FAST_URL` in [`docs/js/config.js`](../docs/js/config.js).

After changing the shared files or `main.js`: `node tools/build-worker.js`, then `npx wrangler@4 deploy`
from this folder.
