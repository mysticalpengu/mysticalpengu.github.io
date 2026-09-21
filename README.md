# ~/mythicalpengu

personal terminal website · dark / emerald · github pages frontend + cloudflare worker notes backend

```
website/
├── index.html            landing — identity, discord presence, mc status, links
├── about.html            about — fill this in yourself
├── mc.html               minecraft server page + live status
├── notes.html            notes
├── css/style.css         design system
├── js/
│   ├── config.js         ★ all personal config lives here
│   ├── main.js           landing entry
│   ├── about-page.js     about entry
│   ├── mc-page.js        mc page entry
│   ├── mc.js             mc server status (mcstatus.io)
│   ├── notes-page.js     notes entry
│   ├── boot.js           boot sequence (ssh + apt install story)
│   ├── presence.js       discord presence (lanyard)
│   ├── notes.js          notes api client
│   ├── commands.js       command palette (ctrl+k)
│   ├── markdown.js       safe markdown renderer
│   ├── ui.js             toast / clipboard
│   └── safe-storage.js   localStorage fallback
├── assets/favicon/
└── backend/              cloudflare worker (see backend/README.md)
```

## live urls

| thing | url |
|---|---|
| site | https://mysticalpengu.github.io |
| notes api | https://mythicalpengu-notes.mysticalpengu.workers.dev |
| oauth callback | https://mythicalpengu-notes.mysticalpengu.workers.dev/auth/callback |

## configuration

edit `js/config.js`:

| key | status |
|---|---|
| `username` | set — `mythicalpengu` |
| `discordUserId` | set — `1497173080131371048` |
| `discordUsername` | set — `mythicalpengu` |
| `title` / `description` | set |
| `email` | set — `mythicalpengu@proton.me` |
| `wynnpoolUrl` | set |
| `minecraftUsername` / `minecraftUrl` | set — namemc profile |
| `notesApi` | set — deployed worker url |
| `mcServerAddress` | `YOUR_MC_SERVER_ADDRESS` — replace with your server ip/hostname |
| `mcServerDisplay` | optional display address for the copy button |

## still to do (owner)

1. **discord oauth app** — https://discord.com/developers/applications → new app →
   oauth2 → add redirect `https://mythicalpengu-notes.mysticalpengu.workers.dev/auth/callback` →
   give me (or set yourself) the client id + secret:
   ```bash
   cd backend
   wrangler secret put DISCORD_CLIENT_ID
   wrangler secret put DISCORD_CLIENT_SECRET
   ```
2. **join the lanyard discord** — https://discord.gg/lanyard — makes presence live
3. **set `mcServerAddress`** — your minecraft server address (widget hides until set)
4. **fill in `about.html`** — yours to write

## backend

see [backend/README.md](backend/README.md). already deployed. to redeploy after changes:

```bash
cd backend
wrangler deploy
```

## discord presence

served by [lanyard](https://github.com/Phineas/lanyard) — join their discord server and
status + what you're playing goes live automatically (websocket push, no polling).
shows: status dot, custom status, activity ("playing minecraft · 42m", spotify track).

## mc status

homepage widget + `/mc` page both use https://mcstatus.io (public api, no key).
note: some big servers (e.g. hypixel) block status pings entirely — if a server
always shows offline, that's the server blocking it, not the site.

## what runs where

| part | runs on |
|---|---|
| pages, boot, palette, links | github pages (static) |
| discord presence | lanyard (public api) |
| mc server status | mcstatus.io (public api) |
| notes storage + auth + owner check | cloudflare worker + kv |
| oauth client secret, session secret, owner id | worker secrets only |

## owner workflow

1. footer → `owner` → discord oauth login
2. notes page → `+ new note` / edit / publish / unpublish / delete
3. drafts are server-side, never public
4. delete asks for confirmation

## security model

- frontend js contains no secrets — everything in `js/` is public
- auth: discord oauth → backend verifies discord user id == owner id → signed
  HttpOnly Secure SameSite=Lax session cookie
- authorization: every write request re-verifies session + owner server-side
- notes markdown is html-escaped before rendering; links restricted to http(s)/mailto
- cors locked to `ALLOWED_ORIGIN`; writes rate-limited; input length-validated

## local development

```bash
cd backend && wrangler dev        # notes api on http://localhost:8787
python -m http.server 8080        # frontend on http://localhost:8080
```

## deploy updates

```bash
git add -A && git commit -m "update" && git push
# pages auto-deploys from main within a minute
```

## troubleshooting

| symptom | fix |
|---|---|
| presence stuck offline | not in the lanyard server, or discord id wrong |
| `couldn't reach the notes service` | worker down, or `notesApi` wrong |
| login bounces back with no session | oauth redirect uri mismatch in discord app settings |
| `auth=not_owner` in url | logged-in discord account ≠ `OWNER_DISCORD_ID` |
| mc server shows offline | server actually offline, or it blocks status pings (hypixel does) |
| boot never replays | plays once per session — palette → `replay boot`, or `index.html?boot=1` |
