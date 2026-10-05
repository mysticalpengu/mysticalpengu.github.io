# backend

notes api — cloudflare worker + kv · owner password login · owner-only writes

## endpoints

```
POST   /auth/login        { password } → { token, expires }
GET    /auth/me           → { authenticated, owner }   (send the token, see below)
POST   /auth/logout       → { ok }                     (the site just forgets the token)
GET    /notes             → published notes (public)
GET    /notes?all=1       → all notes incl. drafts (owner only)
POST   /notes             → create (owner only)
PATCH  /notes/:id         → update / publish / unpublish (owner only)
DELETE /notes/:id         → delete (owner only)
```

owner requests send `Authorization: Bearer <token>`. there are no cookies, so
login works from github.io on every browser.

## setup

```bash
npm install -g wrangler
wrangler login
wrangler kv namespace create NOTES_KV     # only if you don't have one yet
```

put the namespace id in `wrangler.toml`, then set the two secrets:

```bash
wrangler secret put OWNER_PASSWORD        # a long passphrase, 16+ characters
wrangler secret put SESSION_SECRET        # e.g. output of: openssl rand -hex 32
wrangler deploy
```

if you used the old discord login, these are no longer needed and can go:

```bash
wrangler secret delete DISCORD_CLIENT_ID
wrangler secret delete DISCORD_CLIENT_SECRET
wrangler secret delete OWNER_DISCORD_ID
```

## configuration

| var | where | value |
|---|---|---|
| `ALLOWED_ORIGIN` | wrangler.toml `[vars]` | `https://mysticalpengu.github.io` (comma-separate to allow more) |
| `OWNER_PASSWORD` | secret | your login password |
| `SESSION_SECRET` | secret | random 32+ byte string |

## security

- login tokens are hmac-signed and expire after 7 days. changing `SESSION_SECRET` invalidates all of them
- the password and token checks are constant-time
- 5 wrong passwords per ip per 15 minutes, plus a short delay on every wrong guess
- every write re-checks the token on the server; nothing sent from the browser is trusted
- drafts are never returned by the public `GET /notes`
- cors only echoes origins listed in `ALLOWED_ORIGIN` — no wildcard
- writes are rate-limited per ip; input is length- and shape-validated (title ≤ 120, body ≤ 20000, ≤ 5 tags, real dates only)

the token lives in the browser's local storage. that's fine here because the site has no
third-party scripts and notes are html-escaped before rendering — but it's why the password should be long.

## testing

no wrangler needed, the tests run the worker in plain node with an in-memory kv:

```bash
node --test backend/test/worker.test.mjs
```

or run it for real with `wrangler dev` (put `OWNER_PASSWORD=...` and `SESSION_SECRET=...` in `backend/.dev.vars`).
