# ~/mythicalpengu

personal terminal website · dark / emerald · github pages frontend + cloudflare worker notes backend

```
website/
├── index.html            landing
├── notes.html            notes
├── css/style.css         design system
├── js/
│   ├── config.js         ★ all personal config lives here
│   ├── main.js           landing entry
│   ├── notes-page.js     notes entry
│   ├── boot.js           boot sequence
│   ├── presence.js       discord presence (lanyard)
│   ├── notes.js          notes api client
│   ├── commands.js       command palette (ctrl+k)
│   ├── markdown.js       safe markdown renderer
│   ├── ui.js             toast / clipboard
│   └── safe-storage.js   localStorage fallback
├── assets/favicon/
└── backend/              cloudflare worker (see backend/README.md)
```

## configuration

edit `js/config.js`:

| key | status |
|---|---|
| `username` | set — `mythicalpengu` |
| `discordUserId` | set — `1497173080131371048` |
| `discordUsername` | set — `mythicalpengu` |
| `title` | `YOUR_TITLE` — replace |
| `description` | `YOUR_DESCRIPTION` — replace |
| `email` | `YOUR_EMAIL` — replace |
| `wynnpoolUrl` | `YOUR_WYNNPOOL_URL` — replace |
| `minecraftUsername` | `YOUR_MINECRAFT_USERNAME` — replace |
| `minecraftUrl` | `YOUR_MINECRAFT_URL` — replace |
| `notesApi` | `YOUR_NOTES_API` — replace with the deployed worker url |

## frontend — github pages

```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/mysticalpengu/YOUR_REPO_NAME.git
git push -u origin main
```

repo → settings → pages → deploy from `main` / root.

site url: `https://mysticalpengu.github.io/YOUR_REPO_NAME/`

set that exact url (no trailing slash) as `ALLOWED_ORIGIN` in `backend/wrangler.toml`,
and set the deployed worker url as `notesApi` in `js/config.js`.

## backend

see [backend/README.md](backend/README.md). summary:

```bash
cd backend
wrangler kv namespace create NOTES_KV     # put id in wrangler.toml
wrangler secret put DISCORD_CLIENT_ID
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put OWNER_DISCORD_ID      # 1497173080131371048
wrangler secret put SESSION_SECRET
wrangler deploy
```

discord oauth app: https://discord.com/developers/applications → redirect uri
`https://<worker-host>/auth/callback`, scope `identify`.

set `OWNER_DISCORD_ID=1497173080131371048` — only this discord account can log in
and write notes. verified server-side on every request.

## discord presence

presence is served by [lanyard](https://github.com/Phineas/lanyard):

1. join the [lanyard discord server](https://discord.gg/lanyard)
2. presence (status, activity, spotify) then goes live automatically
3. websocket push updates — no polling

until configured/joined, the card shows a calm `offline` state.

## what runs where

| part | runs on |
|---|---|
| pages, boot, palette, links | github pages (static) |
| discord presence | lanyard (public api) |
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

set `notesApi` to `http://localhost:8787` and add `http://localhost:8080`
as an allowed redirect origin for local testing.

## troubleshooting

| symptom | fix |
|---|---|
| presence stuck on `checking presence` | discord id wrong, or not in the lanyard server |
| `couldn't reach the notes service` | `notesApi` unset/wrong, worker not deployed |
| login bounces back with no session | oauth redirect uri mismatch in discord app settings |
| `auth=not_owner` in url | logged-in discord account ≠ `OWNER_DISCORD_ID` |
| drafts invisible after login | press `drafts` on the notes page |
| boot never replays | it plays once per session — use command palette → `replay boot`, or `index.html?boot=1` |
