# ~/mythicalpengu

personal terminal website · dark / emerald · github pages frontend + cloudflare worker notes backend

```
website/
├── index.html            landing — identity, discord presence, mc status, links
├── about.html            about
├── mc.html               minecraft server page + live status + start/stop panel
├── notes.html            notes (owner login with a password)
├── 404.html              not-found page (github pages serves it automatically)
├── css/style.css         design system
├── js/
│   ├── config.js         ★ all personal config lives here
│   ├── common.js         shared page chrome (username, year, palette)
│   ├── main.js           landing entry
│   ├── about-page.js     about entry
│   ├── mc-page.js        mc page entry
│   ├── mc.js             mc server status (mcstatus.io)
│   ├── mc-control.js     start/stop panel on the mc page
│   ├── notes-page.js     notes entry (list, login, editor)
│   ├── notes.js          notes api client + owner token
│   ├── boot.js           boot sequence (ssh + apt install story)
│   ├── presence.js       discord presence (lanyard)
│   ├── commands.js       command palette (ctrl+k, every page)
│   ├── markdown.js       safe markdown renderer
│   ├── ui.js             toast / clipboard / dialog focus handling
│   └── safe-storage.js   local/session storage that never throws
├── assets/favicon/
├── pc/                   mc_controller.py — runs on your pc, does the actual start/stop
├── backend/              cloudflare worker (see backend/README.md)
└── test/                 markdown tests  (backend/test has the worker tests)
```

## where to edit what

- **page text** (greeting, title, description, footer lines, about) → the `.html` files. `config.js` no longer overrides them
- **links, discord id, email, server address** → `js/config.js`
- **look and feel** → `css/style.css`

## live urls

| thing | url |
|---|---|
| site | https://mysticalpengu.github.io |
| notes api | https://mythicalpengu-notes.mysticalpengu.workers.dev |

## configuration

edit `js/config.js`:

| key | status |
|---|---|
| `username` | set — `mythicalpengu` |
| `siteHost` | set — `mysticalpengu.github.io` (used by the boot animation) |
| `discordUserId` / `discordUsername` | set |
| `email` | set |
| `wynnpoolUrl` | set |
| `minecraftUsername` / `minecraftUrl` | set — namemc profile |
| `notesApi` | set — deployed worker url |
| `mcServerAddress` | `YOUR_MC_SERVER_ADDRESS` — replace with your server hostname/ip |
| `mcServerDisplay` | optional display address for the copy button |
| `mcControlUrl` | `YOUR_MC_CONTROL_URL` — public https url of the pc controller (see "mc start/stop") |

## still to do (owner)

1. **set the login secrets and redeploy the worker** (once) — the notes login is a password now:
   ```bash
   cd backend
   wrangler secret put OWNER_PASSWORD     # a long passphrase, 16+ characters
   wrangler secret put SESSION_SECRET     # e.g. output of: openssl rand -hex 32
   wrangler deploy
   ```
   the old discord oauth secrets aren't used any more — see `backend/README.md` to remove them
2. **join the lanyard discord** — https://discord.gg/lanyard — makes presence live
3. **set `mcServerAddress`** (and `mcControlUrl` for the start/stop panel)

## mc start/stop

the mc page has a collapsed **manage** panel (password + start / stop). it only shows once
`mcControlUrl` is set in `js/config.js`.

how it works: the site is static, so a tiny script on your pc does the real work.

```
browser → https url (tailscale funnel) → pc/mc_controller.py → java server
```

on the pc:

1. copy `pc/mc_controller.py` somewhere, put a long random password in `password.txt` next to it
2. edit `SERVER_DIR` / `START_CMD` at the top of the script
3. run it at login with task scheduler (`pythonw.exe mc_controller.py`)
4. install tailscale, then `tailscale funnel --bg 8765` → gives you the public https url
5. put that url in `mcControlUrl`, set `mcServerAddress`, commit + push

notes:

- this password is separate from the notes login. the funnel url is public, so it's the only gate — make it long. 5 wrong tries locks it for 5 minutes
- cors is locked to `https://mysticalpengu.github.io` in the script
- `/status` is public, `/start` and `/stop` need the `X-Password` header
- the pc has to be on. if it isn't, the panel says so

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
| notes storage + login + owner check | cloudflare worker + kv |
| owner password + token signing secret | worker secrets only |
| mc start/stop | your pc (`pc/mc_controller.py`) |

## owner workflow

1. footer → `owner` (or ctrl+k → `owner login`) → type the password
2. notes page → `+ new note` / edit / publish / unpublish / delete
3. drafts live on the server and are never public; an unsaved *new* note is kept on your device if you close the editor
4. delete asks for confirmation; `log out` forgets the token on this device

## security model

- frontend js contains no secrets — everything in `js/` is public
- auth: password → worker checks it in constant time → returns an hmac-signed token (7 days).
  the site keeps it in local storage and sends it as a bearer header. no cookies
- 5 wrong passwords per ip per 15 minutes, plus a short delay on each wrong guess
- authorization: every write re-verifies the token server-side
- notes markdown is html-escaped before rendering; links restricted to http(s)/mailto
- cors only allows the origins in `ALLOWED_ORIGIN`; writes rate-limited; input validated

## local development

```bash
cd backend && wrangler dev        # notes api on http://localhost:8787
python -m http.server 8080        # frontend on http://localhost:8080
```

for local dev put `ALLOWED_ORIGIN = "https://mysticalpengu.github.io,http://localhost:8080"`
in `backend/wrangler.toml`, and your two secrets in `backend/.dev.vars`.

## tests

```bash
node --test test/markdown.test.mjs backend/test/worker.test.mjs
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
| `owner login isn't set up on the server yet` | `OWNER_PASSWORD` / `SESSION_SECRET` not set — see "still to do" |
| `too many tries` on login | 5 wrong passwords from your ip; wait 15 minutes |
| logged out on every visit | browser blocks local storage (private mode) — the token only lives for the tab then |
| mc server shows offline | server actually offline, or it blocks status pings (hypixel does) |
| boot never replays | plays once per session — palette → `replay boot`, or `index.html?boot=1` |
