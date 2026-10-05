// run with:  node --test backend/test
// exercises the worker in plain node with an in-memory kv — no wrangler needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

class FakeKV {
    constructor() { this.map = new Map(); }
    async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
    async put(key, value) { this.map.set(key, String(value)); }
    async delete(key) { this.map.delete(key); }
}

const ORIGIN = "https://mysticalpengu.github.io";
const PASSWORD = "correct horse battery staple";

function makeEnv(extra = {}) {
    return {
        NOTES_KV: new FakeKV(),
        ALLOWED_ORIGIN: `${ORIGIN},http://localhost:8080`,
        OWNER_PASSWORD: PASSWORD,
        SESSION_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
        LOGIN_FAIL_DELAY_MS: 0,
        ...extra,
    };
}

async function call(env, method, path, { body, token, origin = ORIGIN, ip = "1.2.3.4" } = {}) {
    const headers = { Origin: origin, "CF-Connecting-IP": ip };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await worker.fetch(new Request(`https://api.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const data = await res.json().catch(() => null);
    return { res, data };
}

async function login(env, password = PASSWORD) {
    const { res, data } = await call(env, "POST", "/auth/login", { body: { password } });
    return { status: res.status, token: data && data.token, data };
}

test("login is disabled until secrets are set", async () => {
    const env = makeEnv({ OWNER_PASSWORD: undefined });
    assert.equal((await login(env)).status, 503);
});

test("wrong password is rejected, right password returns a token", async () => {
    const env = makeEnv();
    assert.equal((await login(env, "nope")).status, 401);
    const ok = await login(env);
    assert.equal(ok.status, 200);
    assert.match(ok.token, /^\d+\.[A-Za-z0-9_-]+$/);
});

test("login locks out one ip after 5 wrong passwords, others unaffected", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) assert.equal((await login(env, "bad")).status, 401);
    assert.equal((await login(env)).status, 429);         // even the right one, until the window rolls
    const other = await call(env, "POST", "/auth/login", { body: { password: PASSWORD }, ip: "9.9.9.9" });
    assert.equal(other.res.status, 200);
});

test("tokens: valid, missing, garbage, tampered and expired", async () => {
    const env = makeEnv();
    const { token } = await login(env);

    assert.equal((await call(env, "GET", "/auth/me", { token })).data.owner, true);
    assert.equal((await call(env, "GET", "/auth/me")).data.owner, false);
    assert.equal((await call(env, "GET", "/auth/me", { token: "garbage" })).data.owner, false);

    const [exp, sig] = token.split(".");
    const tampered = `${Number(exp) + 99999}.${sig}`;
    assert.equal((await call(env, "GET", "/auth/me", { token: tampered })).data.owner, false);

    // a correctly signed but already-expired token
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const past = Math.floor(Date.now() / 1000) - 10;
    const raw = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`owner.${past}`)));
    const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal((await call(env, "GET", "/auth/me", { token: `${past}.${b64}` })).data.owner, false);
});

test("notes: writes need the owner, drafts stay private, full crud works", async () => {
    const env = makeEnv();
    const note = { title: "hello", body: "**hi**", date: "2026-10-04", tags: ["Random", "random", "build"], status: "draft" };

    assert.equal((await call(env, "POST", "/notes", { body: note })).res.status, 401);

    const { token } = await login(env);
    const created = await call(env, "POST", "/notes", { body: note, token });
    assert.equal(created.res.status, 201);
    assert.deepEqual(created.data.note.tags, ["random", "build"]);   // lower-cased + de-duplicated
    const id = created.data.note.id;

    assert.equal((await call(env, "GET", "/notes")).data.notes.length, 0);                    // draft is private
    assert.equal((await call(env, "GET", "/notes?all=1")).res.status, 401);
    assert.equal((await call(env, "GET", "/notes?all=1", { token })).data.notes.length, 1);

    const published = await call(env, "PATCH", `/notes/${id}`, { body: { status: "published" }, token });
    assert.equal(published.data.note.status, "published");
    assert.equal(published.data.note.title, "hello");                                        // untouched fields survive
    assert.equal((await call(env, "GET", "/notes")).data.notes.length, 1);

    assert.equal((await call(env, "DELETE", `/notes/${id}`)).res.status, 401);
    assert.equal((await call(env, "DELETE", `/notes/${id}`, { token })).res.status, 200);
    assert.equal((await call(env, "GET", "/notes?all=1", { token })).data.notes.length, 0);
});

test("notes: validation", async () => {
    const env = makeEnv();
    const { token } = await login(env);
    const base = { title: "t", body: "b", date: "2026-10-04", tags: [], status: "draft" };
    const post = (extra) => call(env, "POST", "/notes", { body: { ...base, ...extra }, token });

    assert.equal((await post({ title: "" })).res.status, 400);
    assert.equal((await post({ date: "2026-02-31" })).res.status, 400);                      // not a real date
    assert.equal((await post({ date: "yesterday" })).res.status, 400);
    assert.equal((await post({ tags: ["a", "b", "c", "d", "e", "f"] })).res.status, 400);
    assert.equal((await post({ body: "x".repeat(20001) })).res.status, 400);
    assert.equal((await post({})).res.status, 201);
});

test("cors: allowed origins are echoed, others get nothing, preflight allows Authorization", async () => {
    const env = makeEnv();
    const good = await call(env, "GET", "/notes");
    assert.equal(good.res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.equal(good.res.headers.get("Access-Control-Allow-Credentials"), null);

    const dev = await call(env, "GET", "/notes", { origin: "http://localhost:8080" });
    assert.equal(dev.res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");

    const evil = await call(env, "GET", "/notes", { origin: "https://evil.example" });
    assert.equal(evil.res.headers.get("Access-Control-Allow-Origin"), null);

    const pre = await worker.fetch(new Request("https://api.test/notes", {
        method: "OPTIONS", headers: { Origin: ORIGIN },
    }), env);
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("unknown routes 404 as json", async () => {
    const { res, data } = await call(makeEnv(), "GET", "/nope");
    assert.equal(res.status, 404);
    assert.equal(data.error, "not found");
});
