// notes.js — notes API client + owner session handling.
// all writes go through the backend worker, which enforces owner-only access.

import { CONFIG } from "./config.js";

const configured = () => CONFIG.notesApi && !CONFIG.notesApi.startsWith("YOUR_");

function base() {
    return CONFIG.notesApi.replace(/\/+$/, "");
}

async function request(path, options = {}) {
    const res = await fetch(`${base()}${path}`, {
        credentials: "include",
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || `request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

export function apiConfigured() {
    return configured();
}

export function loginUrl() {
    const redirect = new URL("notes.html", window.location.href).href;
    return `${base()}/auth/login?redirect=${encodeURIComponent(redirect)}`;
}

export async function whoAmI() {
    if (!configured()) return { authenticated: false, owner: false };
    try {
        return await request("/auth/me");
    } catch {
        return { authenticated: false, owner: false };
    }
}

export async function logout() {
    try { await request("/auth/logout", { method: "POST" }); } catch { /* session already gone */ }
}

export async function fetchPublicNotes() {
    const data = await request("/notes");
    return data.notes || [];
}

export async function fetchAllNotes() {
    const data = await request("/notes?all=1");
    return data.notes || [];
}

export async function createNote(fields) {
    return request("/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
    });
}

export async function updateNote(id, fields) {
    return request(`/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
    });
}

export async function deleteNote(id) {
    return request(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// local unsaved-editor draft, kept out of the way and never auto-published
const DRAFT_KEY = "notes:editor-draft";

export function saveLocalDraft(note) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ note, at: Date.now() }));
    } catch { /* storage unavailable — draft is lost, page keeps working */ }
}

export function loadLocalDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.note ? parsed.note : null;
    } catch {
        return null;
    }
}

export function clearLocalDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
}
