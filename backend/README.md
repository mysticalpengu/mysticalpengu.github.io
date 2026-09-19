# backend

notes api — cloudflare worker + kv · discord oauth · owner-only writes

## endpoints

```
GET    /auth/login        → discord oauth (redirect param supported)
GET    /auth/callback     → oauth callback, sets session cookie
GET    /auth/me           → { authenticated, owner }
POST   /auth/logout       → clears session
GET    /notes             → published notes (public)
GET    /notes?all=1       → all notes incl. drafts (owner only)
POST   /notes             → create (owner only)
PATCH  /notes/:id         → update / publish / unpublish (owner only)
DELETE /notes/:id         → delete (owner only)
```

## setup

```bash
npm install -g wrangler
wrangler login
wrangler kv namespace create NOTES_KV
```

put the namespace id in `wrangler.toml`.

secrets:

```bash
wrangler secret put DISCORD_CLIENT_ID
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put OWNER_DISCORD_ID      # 1497173080131371048
wrangler secret put SESSION_SECRET        # long random string, e.g. `openssl rand -hex 32`
```

deploy:

```bash
wrangler deploy
```

## discord oauth app

1. https://discord.com/developers/applications → new application
2. oauth2 → add redirect: `https://<worker-host>/auth/callback`
3. copy client id + client secret into the secrets above
4. the app must request only the `identify` scope

## configuration

| var | where | value |
|---|---|---|
| `ALLOWED_ORIGIN` | wrangler.toml `[vars]` | github pages url, e.g. `https://mythicalpengu.github.io` |
| `REDIRECT_URI` | wrangler.toml `[vars]` | `https://<worker-host>/auth/callback` |
| `DISCORD_CLIENT_ID` | secret | discord app client id |
| `DISCORD_CLIENT_SECRET` | secret | discord app client secret |
| `OWNER_DISCORD_ID` | secret | `1497173080131371048` |
| `SESSION_SECRET` | secret | random 32+ byte string |

## security

- sessions are hmac-signed, `HttpOnly` `Secure` `SameSite=Lax` cookies — no tokens in js
- the callback verifies the discord user id against `OWNER_DISCORD_ID` server-side; nothing sent from the browser is trusted
- all writes re-verify the session + owner match on every request
- drafts are never returned by the public `GET /notes`
- cors is locked to `ALLOWED_ORIGIN` — no wildcard
- writes are rate-limited per ip via kv
- input limits: title ≤ 120 chars, body ≤ 20000 chars, ≤ 5 tags (30 chars each)
- frontend rendering escapes all html before markdown formatting

## testing

```bash
wrangler dev
```

`GET /notes` returns `{ "notes": [] }` on a fresh namespace.
