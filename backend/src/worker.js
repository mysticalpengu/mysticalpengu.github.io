// notes backend — cloudflare worker
// password login (owner only) · kv storage · hmac-signed bearer tokens
//
// the password starts as the OWNER_PASSWORD secret. once you change it from the
// site, a salted hash is stored in kv (auth:password) and the secret is ignored.
// to go back to the secret, delete that kv key.
//
// auth model: POST /auth/login with the owner password returns a signed token.
// the site keeps the token and sends it as `Authorization: Bearer <token>`.
// no cookies, so it works across github.io → workers.dev in every browser.

const TOKEN_TTL = 7 * 24 * 60 * 60;   // seconds
const MAX_TITLE = 120;
const MAX_BODY = 20000;
const MAX_TAGS = 5;
const MAX_TAG_LEN = 30;
const MAX_JSON_BYTES = 64 * 1024;

const WRITE_LIMIT = 30;               // writes per window, per ip
const WRITE_WINDOW = 10 * 60;         // seconds
const LOGIN_LIMIT = 5;                // wrong passwords per window, per ip
const LOGIN_WINDOW = 15 * 60;         // seconds
const LOGIN_FAIL_DELAY_MS = 700;      // slows down guessing

const PASSWORD_KEY = "auth:password";
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 256;
// modest on purpose: free workers get a tiny cpu budget, and logins are rate limited anyway
const PBKDF2_ITERATIONS = 30000;

export default {
    async fetch(request, env) {
        const origin = pickOrigin(request, env);

        if (request.method === "OPTIONS") {
            return cors(new Response(null, { status: 204 }), origin);
        }

        try {
            return cors(await route(request, env), origin);
        } catch (err) {
            console.error("unhandled error", err);
            return cors(json({ error: "internal error" }, 500), origin);
        }
    },
};

async function route(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (path === "/auth/login" && method === "POST") return handleLogin(request, env);
    if (path === "/auth/me" && method === "GET") return handleMe(request, env);
    if (path === "/auth/password" && method === "POST") return handleChangePassword(request, env);
    if (path === "/auth/logout" && method === "POST") return json({ ok: true });

    if (path === "/notes" && method === "GET") return handleList(request, env, url);
    if (path === "/notes" && method === "POST") return handleCreate(request, env);

    const noteMatch = path.match(/^\/notes\/([A-Za-z0-9_-]+)$/);
    if (noteMatch) {
        if (method === "PATCH") return handleUpdate(request, env, noteMatch[1]);
        if (method === "DELETE") return handleDelete(request, env, noteMatch[1]);
    }

    return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
async function handleLogin(request, env) {
    const stored = await readPasswordRecord(env);
    if (!env.SESSION_SECRET || (!stored && !env.OWNER_PASSWORD)) {
        return json({ error: "owner login isn't set up yet" }, 503);
    }

    const ip = requestIp(request);
    if (await isRateLimited(env, `login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW)) {
        return json({ error: "too many wrong passwords, try again later" }, 429);
    }

    const body = await readJson(request);
    if (!body || typeof body.password !== "string" || body.password.length === 0 || body.password.length > MAX_PASSWORD) {
        return json({ error: "password required" }, 400);
    }

    if (!(await checkPassword(body.password, stored, env))) {
        await bumpRateLimit(env, `login:${ip}`, LOGIN_WINDOW);
        await sleep(Number(env.LOGIN_FAIL_DELAY_MS ?? LOGIN_FAIL_DELAY_MS));
        return json({ error: "wrong password" }, 401);
    }

    const expires = nowSeconds() + TOKEN_TTL;
    const token = await makeToken(expires, env.SESSION_SECRET, versionOf(stored));
    return json({ token, expires });
}

// change the owner password: needs a valid session AND the current password
async function handleChangePassword(request, env) {
    const denied = await requireOwner(request, env);
    if (denied) return denied;

    const ip = requestIp(request);
    if (await isRateLimited(env, `login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW)) {
        return json({ error: "too many wrong passwords, try again later" }, 429);
    }

    const body = await readJson(request);
    const current = body && body.current;
    const next = body && body.next;
    if (typeof current !== "string" || typeof next !== "string" || !current) {
        return json({ error: "current and new password required" }, 400);
    }
    if (next.length < MIN_PASSWORD) return json({ error: `new password must be at least ${MIN_PASSWORD} characters` }, 400);
    if (next.length > MAX_PASSWORD) return json({ error: `new password must be under ${MAX_PASSWORD} characters` }, 400);
    if (next === current) return json({ error: "new password must be different" }, 400);

    const stored = await readPasswordRecord(env);
    if (!(await checkPassword(current, stored, env))) {
        await bumpRateLimit(env, `login:${ip}`, LOGIN_WINDOW);
        await sleep(Number(env.LOGIN_FAIL_DELAY_MS ?? LOGIN_FAIL_DELAY_MS));
        // 403, not 401: the session is fine, only the typed password was wrong
        return json({ error: "current password is wrong" }, 403);
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const record = {
        v: randomId(16),
        salt: toBase64Url(salt),
        hash: toBase64Url(await pbkdf2(next, salt, PBKDF2_ITERATIONS)),
        iter: PBKDF2_ITERATIONS,
    };
    await env.NOTES_KV.put(PASSWORD_KEY, JSON.stringify(record));

    // every older token carried the old version, so they all stop working.
    // hand back a fresh one so this browser stays logged in.
    const expires = nowSeconds() + TOKEN_TTL;
    const token = await makeToken(expires, env.SESSION_SECRET, record.v);
    return json({ token, expires });
}

async function handleMe(request, env) {
    const owner = await isOwner(request, env);
    return json({ authenticated: owner, owner });
}

async function readPasswordRecord(env) {
    try {
        const raw = await env.NOTES_KV.get(PASSWORD_KEY);
        const record = raw ? JSON.parse(raw) : null;
        return record && record.v && record.salt && record.hash && record.iter ? record : null;
    } catch {
        return null;
    }
}

// "env" while the secret is the password, a random id once it's been changed
const versionOf = (stored) => (stored ? stored.v : "env");

async function checkPassword(candidate, stored, env) {
    if (stored) {
        const derived = await pbkdf2(candidate, fromBase64Url(stored.salt), stored.iter);
        return bytesEqual(derived, fromBase64Url(stored.hash));
    }
    return safeEqual(candidate, env.OWNER_PASSWORD, env.SESSION_SECRET);
}

async function makeToken(expires, secret, version) {
    const sig = await sign(`owner.${expires}.${version}`, secret);
    return `${expires}.${sig}`;
}

async function isOwner(request, env) {
    if (!env.SESSION_SECRET) return false;

    const header = request.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) return false;

    const [expires, sig, ...rest] = match[1].split(".");
    if (!expires || !sig || rest.length > 0) return false;
    if (!/^\d{1,12}$/.test(expires)) return false;
    if (parseInt(expires, 10) <= nowSeconds()) return false;

    const version = versionOf(await readPasswordRecord(env));
    const expected = await sign(`owner.${expires}.${version}`, env.SESSION_SECRET);
    return safeEqual(sig, expected, env.SESSION_SECRET);
}

async function requireOwner(request, env) {
    if (await isOwner(request, env)) return null;
    return json({ error: "unauthorized" }, 401);
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------
async function handleList(request, env, url) {
    const wantsAll = url.searchParams.get("all") === "1";
    if (wantsAll) {
        const denied = await requireOwner(request, env);
        if (denied) return denied;
    }

    const notes = await readNotes(env);
    const visible = wantsAll ? notes : notes.filter((n) => n.status === "published");
    visible.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return json({ notes: visible });
}

async function handleCreate(request, env) {
    const denied = await requireOwner(request, env);
    if (denied) return denied;
    if (await isRateLimited(env, `write:${requestIp(request)}`, WRITE_LIMIT, WRITE_WINDOW, true)) {
        return json({ error: "too many requests" }, 429);
    }

    const body = await readJson(request);
    if (!body) return json({ error: "invalid or too large json" }, 400);

    const note = validateNote(body);
    if (note.error) return json({ error: note.error }, 400);

    const id = randomId(12);
    const today = new Date().toISOString().slice(0, 10);
    const record = { id, ...note.fields, created: today, updated: today };

    await env.NOTES_KV.put(`note:${id}`, JSON.stringify(record));
    await updateIndex(env, (ids) => [id, ...ids]);

    return json({ note: record }, 201);
}

async function handleUpdate(request, env, id) {
    const denied = await requireOwner(request, env);
    if (denied) return denied;
    if (await isRateLimited(env, `write:${requestIp(request)}`, WRITE_LIMIT, WRITE_WINDOW, true)) {
        return json({ error: "too many requests" }, 429);
    }

    const raw = await env.NOTES_KV.get(`note:${id}`);
    if (!raw) return json({ error: "note not found" }, 404);
    const existing = JSON.parse(raw);

    const body = await readJson(request);
    if (!body) return json({ error: "invalid or too large json" }, 400);

    // partial update: validate the merged result, keep only whitelisted fields
    const check = validateNote({ ...existing, ...body });
    if (check.error) return json({ error: check.error }, 400);

    const merged = {
        ...existing,
        ...check.fields,
        updated: new Date().toISOString().slice(0, 10),
    };

    await env.NOTES_KV.put(`note:${id}`, JSON.stringify(merged));
    return json({ note: merged });
}

async function handleDelete(request, env, id) {
    const denied = await requireOwner(request, env);
    if (denied) return denied;
    if (await isRateLimited(env, `write:${requestIp(request)}`, WRITE_LIMIT, WRITE_WINDOW, true)) {
        return json({ error: "too many requests" }, 429);
    }

    await env.NOTES_KV.delete(`note:${id}`);
    await updateIndex(env, (ids) => ids.filter((x) => x !== id));
    return json({ ok: true });
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
// validation
// ---------------------------------------------------------------------------
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validateNote(body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.body === "string" ? body.body : "";
    const date = typeof body.date === "string" ? body.date : "";
    const status = body.status === "published" ? "published" : "draft";
    const rawTags = Array.isArray(body.tags) ? body.tags : [];

    if (!title || title.length > MAX_TITLE) return { error: `title must be 1-${MAX_TITLE} characters` };
    if (text.length > MAX_BODY) return { error: `body must be under ${MAX_BODY} characters` };
    if (!validDate(date)) return { error: "date must be a real date, YYYY-MM-DD" };
    if (rawTags.some((t) => typeof t !== "string")) return { error: "tags must be text" };

    const tags = [...new Set(rawTags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LEN)) {
        return { error: `max ${MAX_TAGS} tags, ${MAX_TAG_LEN} characters each` };
    }

    return { fields: { title, body: text, date, status, tags } };
}

// ---------------------------------------------------------------------------
// rate limiting — fixed windows in kv (good enough for one owner)
// ---------------------------------------------------------------------------
function bucketKey(name, windowSeconds) {
    return `rl:${name}:${Math.floor(nowSeconds() / windowSeconds)}`;
}

async function readCount(env, key) {
    return parseInt((await env.NOTES_KV.get(key)) || "0", 10) || 0;
}

async function bumpRateLimit(env, name, windowSeconds) {
    const key = bucketKey(name, windowSeconds);
    const count = await readCount(env, key);
    await env.NOTES_KV.put(key, String(count + 1), { expirationTtl: windowSeconds * 2 });
}

// count = true → this call itself counts as one use (writes);
// count = false → only checks (logins count failures separately)
async function isRateLimited(env, name, limit, windowSeconds, count = false) {
    const key = bucketKey(name, windowSeconds);
    const current = await readCount(env, key);
    if (current >= limit) return true;
    if (count) {
        await env.NOTES_KV.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
    }
    return false;
}

// ---------------------------------------------------------------------------
// crypto helpers
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();

async function hmacBytes(data, secret) {
    const key = await crypto.subtle.importKey(
        "raw", encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

async function sign(data, secret) {
    return toBase64Url(await hmacBytes(data, secret));
}

// constant-time compare: hash both sides first so lengths never leak
async function safeEqual(a, b, secret) {
    const [x, y] = await Promise.all([hmacBytes(a, secret), hmacBytes(b, secret)]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return new Uint8Array(bits);
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

function fromBase64Url(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes) {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomId(length) {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

// ---------------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------------
const nowSeconds = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestIp(request) {
    return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function readJson(request) {
    try {
        const declared = Number(request.headers.get("Content-Length") || 0);
        if (declared > MAX_JSON_BYTES) return null;
        const text = await request.text();
        if (text.length > MAX_JSON_BYTES) return null;
        const data = JSON.parse(text);
        return data && typeof data === "object" && !Array.isArray(data) ? data : null;
    } catch {
        return null;
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
}

// ALLOWED_ORIGIN can hold several comma-separated origins (site + local dev)
function pickOrigin(request, env) {
    const allowed = String(env.ALLOWED_ORIGIN || "")
        .split(",")
        .map((o) => o.trim().replace(/\/+$/, ""))
        .filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    return allowed.includes(origin) ? origin : "";
}

function cors(res, origin) {
    const headers = new Headers(res.headers);
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(res.body, { status: res.status, headers });
}
