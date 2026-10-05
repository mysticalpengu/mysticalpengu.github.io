// notes.js — notes api client + owner session.
//
// login = POST the password to the worker, get back a signed token, keep it in
// local storage and send it as `Authorization: Bearer <token>` on owner requests.
// the worker re-checks the token on every write — this file only carries it.

import { CONFIG } from "./config.js";
import { safeStorage } from "./safe-storage.js";

const TOKEN_KEY = "owner:token";
const TIMEOUT_MS = 12 * 1000;

const configured = () => !!CONFIG.notesApi && !CONFIG.notesApi.startsWith("YOUR_");
const base = () => CONFIG.notesApi.replace(/\/+$/, "");

export function apiConfigured() {
    return configured();
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------
function readSession() {
    const raw = safeStorage.get(TOKEN_KEY);
    if (!raw) return null;
    try {
        const session = JSON.parse(raw);
        if (session && typeof session.token === "string" && session.expires * 1000 > Date.now()) {
            return session;
        }
    } catch { /* corrupt value, drop it below */ }
    safeStorage.remove(TOKEN_KEY);
    return null;
}

export function hasSession() {
    return readSession() !== null;
}

export function clearSession() {
    safeStorage.remove(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------
async function request(path, options = {}, { auth = false } = {}) {
    const headers = { ...(options.headers || {}) };
    if (auth) {
        const session = readSession();
        if (session) headers.Authorization = `Bearer ${session.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${base()}${path}`, { ...options, headers, signal: controller.signal });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const err = new Error(data.error || `request failed (${res.status})`);
            err.status = res.status;
            // an owner request that gets 401 means the token is no good any more
            if (auth && res.status === 401) clearSession();
            throw err;
        }
        return data;
    } catch (err) {
        if (err.name === "AbortError") {
            const timeout = new Error("the notes service took too long");
            timeout.status = 0;
            throw timeout;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

const jsonOptions = (method, payload) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
export async function login(password) {
    const data = await request("/auth/login", jsonOptions("POST", { password }));
    safeStorage.set(TOKEN_KEY, JSON.stringify({ token: data.token, expires: data.expires }));
}

// asks the server whether the stored token is still good (never trusts local state)
export async function whoAmI() {
    if (!configured() || !hasSession()) return { owner: false };
    try {
        const data = await request("/auth/me", {}, { auth: true });
        if (!data.owner) clearSession();
        return { owner: !!data.owner };
    } catch (err) {
        // network trouble: keep the token, just don't unlock owner mode this time
        return { owner: false, error: true, status: err.status };
    }
}

export function logout() {
    clearSession();
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------
export async function fetchPublicNotes() {
    const data = await request("/notes");
    return data.notes || [];
}

export async function fetchAllNotes() {
    const data = await request("/notes?all=1", {}, { auth: true });
    return data.notes || [];
}

export const createNote = (fields) =>
    request("/notes", jsonOptions("POST", fields), { auth: true });

export const updateNote = (id, fields) =>
    request(`/notes/${encodeURIComponent(id)}`, jsonOptions("PATCH", fields), { auth: true });

export const deleteNote = (id) =>
    request(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" }, { auth: true });

// ---------------------------------------------------------------------------
// unsaved new-note draft, kept on this device only and never auto-published
// ---------------------------------------------------------------------------
const DRAFT_KEY = "notes:editor-draft";

export function saveLocalDraft(note) {
    safeStorage.set(DRAFT_KEY, JSON.stringify({ note, at: Date.now() }));
}

export function loadLocalDraft() {
    try {
        const raw = safeStorage.get(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.note ? parsed.note : null;
    } catch {
        return null;
    }
}

export function clearLocalDraft() {
    safeStorage.remove(DRAFT_KEY);
}
