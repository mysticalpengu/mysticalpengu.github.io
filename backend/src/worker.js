// notes backend — cloudflare worker
// discord oauth (owner-only) · kv storage · hmac-signed sessions

const SESSION_COOKIE = "notes_session";
const STATE_COOKIE = "notes_oauth_state";
const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days, seconds
const MAX_TITLE = 120;
const MAX_BODY = 20000;
const MAX_TAGS = 5;
const RATE_LIMIT = 30;          // writes per window
const RATE_WINDOW = 10 * 60;    // 10 minutes, seconds

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = env.ALLOWED_ORIGIN || "";

        if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);

        try {
            return route(request, env, url, origin);
        } catch (err) {
            return cors(json({ error: "internal error" }, 500), origin);
        }
    },
};

async function route(request, env, url, origin) {
    const path = url.pathname.replace(/\/+$/, "");

    if (path === "/auth/login") return handleLogin(request, env, url, origin);
    if (path === "/auth/callback") return handleCallback(env, url, origin);
    if (path === "/auth/me") return handleMe(env, request, origin);
    if (path === "/auth/logout") return handleLogout(request, env, origin);

    if (path === "/notes" && request.method === "GET") return handleList(env, request, origin);
    if (path === "/notes" && request.method === "POST") return handleCreate(env, request, origin);

    const noteMatch = path.match(/^\/notes\/([A-Za-z0-9_-]+)$/);
    if (noteMatch) {
        if (request.method === "PATCH") return handleUpdate(env, request, origin, noteMatch[1]);
        if (request.method === "DELETE") return handleDelete(env, request, origin, noteMatch[1]);
    }

    return cors(json({ error: "not found" }, 404), origin);
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
async function handleLogin(request, env, url, origin) {
    const ip = requestIp(request);
    const limited = await rateLimit(env, `rl:login:${ip}`, 10, RATE_WINDOW);
    if (limited) return cors(json({ error: "too many requests" }, 429), origin);

    const state = randomId(24);
    const redirect = url.searchParams.get("redirect") || env.ALLOWED_ORIGIN || "";
    const safeRedirect = redirect.startsWith(origin) ? redirect : origin;

    const params = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: env.REDIRECT_URI || `${new URL(url.href).origin}/auth/callback`,
        response_type: "code",
        scope: "identify",
        state,
    });

    const res = Response.redirect(`https://discord.com/oauth2/authorize?${params}`, 302);
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", cookie(STATE_COOKIE, `${state}|${safeRedirect}`, 600));
    return cors(new Response(null, { status: 302, headers }), origin);
}

async function handleCallback(env, url, origin) {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const stored = (cookies[STATE_COOKIE] || "").split("|");
    const savedState = stored[0];
    const safeRedirect = stored[1] || origin;

    if (!code || !state || !savedState || state !== savedState) {
        return Response.redirect(`${safeRedirect}?auth=invalid_state`, 302);
    }

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: env.REDIRECT_URI || `${url.origin}/auth/callback`,
        }),
    });
    if (!tokenRes.ok) return Response.redirect(`${safeRedirect}?auth=failed`, 302);
    const token = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) return Response.redirect(`${safeRedirect}?auth=failed`, 302);
    const discordUser = await userRes.json();

    // authorization: only the configured owner id may hold a session
    if (discordUser.id !== env.OWNER_DISCORD_ID) {
        return Response.redirect(`${safeRedirect}?auth=not_owner`, 302);
    }

    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
    const sig = await sign(`${discordUser.id}.${exp}`, env.SESSION_SECRET);
    const value = `${discordUser.id}.${exp}.${sig}`;

    const headers = new Headers();
    headers.set("Location", safeRedirect);
    headers.append("Set-Cookie", cookie(SESSION_COOKIE, value, SESSION_TTL));
    headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
}

async function handleMe(env, request, origin) {
    const session = await verifySession(env, request);
    return cors(json({ authenticated: !!session, owner: !!session, userId: session || null }), origin, request);
}

async function handleLogout(env, origin) {
    const headers = new Headers();
    headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
    return cors(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...Object.fromEntries(headers) },
    }), origin);
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------
async function handleList(env, request, origin) {
    const wantsAll = new URL(request.url).searchParams.get("all") === "1";
    if (wantsAll) {
        const session = await verifySession(env, request);
        if (!session) return cors(json({ error: "unauthorized" }, 401), origin);
    }

    const notes = await readNotes(env);
    const visible = wantsAll ? notes : notes.filter((n) => n.status === "published");
    visible.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return cors(json({ notes: visible }), origin);
}

async function handleCreate(env, request, origin) {
    const session = await requireOwner(env, request, origin);
    if (session instanceof Response) return session;

    const limited = await rateLimit(env, `rl:write:${requestIp(request)}`, RATE_LIMIT, RATE_WINDOW);
    if (limited) return cors(json({ error: "too many requests" }, 429), origin);

    const body = await readJson(request);
    if (!body) return cors(json({ error: "invalid json" }, 400), origin);

    const note = validateNote(body);
    if (note.error) return cors(json({ error: note.error }, 400), origin);

    const id = randomId(10);
    const now = new Date().toISOString().slice(0, 10);
    const record = { id, ...note.fields, created: now, updated: now };

    await env.NOTES_KV.put(`note:${id}`, JSON.stringify(record));
    await updateIndex(env, (ids) => [id, ...ids]);

    return cors(json({ note: record }, 201), origin);
}

async function handleUpdate(env, request, origin, id) {
    const session = await requireOwner(env, request, origin);
    if (session instanceof Response) return session;

    const limited = await rateLimit(env, `rl:write:${requestIp(request)}`, RATE_LIMIT, RATE_WINDOW);
    if (limited) return cors(json({ error: "too many requests" }, 429), origin);

    const raw = await env.NOTES_KV.get(`note:${id}`);
    if (!raw) return cors(json({ error: "note not found" }, 404), origin);
    const existing = JSON.parse(raw);

    const body = await readJson(request);
    if (!body) return cors(json({ error: "invalid json" }, 400), origin);

    // partial update: merge validated fields over the existing note
    const merged = { ...existing };
    if ("title" in body || "body" in body || "date" in body || "tags" in body || "status" in body) {
        const check = validateNote({ ...merged, ...body });
        if (check.error) return cors(json({ error: check.error }, 400), origin);
        Object.assign(merged, check.fields);
    }
    merged.updated = new Date().toISOString().slice(0, 10);

    await env.NOTES_KV.put(`note:${id}`, JSON.stringify(merged));
    return cors(json({ note: merged }), origin);
}

async function handleDelete(env, request, origin, id) {
    const session = await requireOwner(env, request, origin);
    if (session instanceof Response) return session;

    const limited = await rateLimit(env, `rl:write:${requestIp(request)}`, RATE_LIMIT, RATE_WINDOW);
    if (limited) return cors(json({ error: "too many requests" }, 429), origin);

    await env.NOTES_KV.delete(`note:${id}`);
    await updateIndex(env, (ids) => ids.filter((x) => x !== id));
    return cors(json({ ok: true }), origin);
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
async function readNotes(env) {
    const index = await env.NOTES_KV.get("notes:index");
    const ids = index ? JSON.parse(index) : [];
    const notes = await Promise.all(
        ids.map(async (id) => {
            const raw = await env.NOTES_KV.get(`note:${id}`);
            return raw ? JSON.parse(raw) : null;
        })
    );
    return notes.filter(Boolean);
}

async function updateIndex(env, transform) {
    const index = await env.NOTES_KV.get("notes:index");
    const ids = transform(index ? JSON.parse(index) : []);
    await env.NOTES_KV.put("notes:index", JSON.stringify(ids));
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
async function sign(data, secret) {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifySession(env, request) {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const value = cookies[SESSION_COOKIE];
    if (!value) return null;

    const [uid, exp, sig] = value.split(".");
    if (!uid || !exp || !sig) return null;
    if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return null;

    const expected = await sign(`${uid}.${exp}`, env.SESSION_SECRET);
    if (sig !== expected) return null;
    return uid;
}

async function requireOwner(env, request, origin) {
    const uid = await verifySession(env, request);
    if (!uid || uid !== env.OWNER_DISCORD_ID) {
        return cors(json({ error: "unauthorized" }, 401), origin);
    }
    return uid;
}

// ---------------------------------------------------------------------------
// validation + helpers
// ---------------------------------------------------------------------------
function validateNote(body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.body === "string" ? body.body : "";
    const date = typeof body.date === "string" ? body.date : "";
    const status = body.status === "published" ? "published" : "draft";
    const tags = Array.isArray(body.tags) ? body.tags : [];

    if (!title || title.length > MAX_TITLE) return { error: "title must be 1-120 characters" };
    if (text.length > MAX_BODY) return { error: `body must be under ${MAX_BODY} characters` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
    if (tags.length > MAX_TAGS || tags.some((t) => typeof t !== "string" || t.length > 30)) {
        return { error: `max ${MAX_TAGS} tags, 30 characters each` };
    }

    return {
        fields: {
            title,
            body: text,
            date,
            status,
            tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
        },
    };
}

async function rateLimit(env, key, limit, windowSeconds) {
    const current = parseInt((await env.NOTES_KV.get(key)) || "0", 10);
    if (current >= limit) return true;
    await env.NOTES_KV.put(key, String(current + 1), { expirationTtl: windowSeconds });
    return false;
}

function requestIp(request) {
    return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function readJson(request) {
    try { return await request.json(); } catch { return null; }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function cors(res, origin, request) {
    const headers = new Headers(res.headers);
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(res.body, { status: res.status, headers });
}

function cookie(name, value, maxAge) {
    const attrs = [
        `${name}=${value}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${maxAge}`,
    ];
    return attrs.join("; ");
}

function parseCookies(header) {
    const out = {};
    header.split(";").forEach((part) => {
        const idx = part.indexOf("=");
        if (idx === -1) return;
        out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    });
    return out;
}

function randomId(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, length * 2);
}
