// presence.js — live Discord presence via Lanyard.
// uses the websocket when possible (push updates, no polling),
// falls back to rest, and degrades to a calm "presence unavailable"
// if the service can't be reached. never breaks the page.

import { CONFIG } from "./config.js";

const LANYARD_WS = "wss://api.lanyard.rest/socket";
const LANYARD_REST = "https://api.lanyard.rest/v1/users";
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const REST_FALLBACK_INTERVAL = 60 * 1000;

const STATUS_LABELS = {
    online: "online",
    idle: "idle",
    dnd: "do not disturb",
    offline: "offline",
};

let ws = null;
let heartbeatTimer = null;
let reconnectDelay = 1000;
let restTimer = null;
let lastData = null;
let lastHeartbeat = 0;
let socketOpen = false;

function isConfigured() {
    return CONFIG.discordUserId && !CONFIG.discordUserId.startsWith("YOUR_");
}

export function initPresence() {
    const dot = document.getElementById("presence-dot");
    const label = document.getElementById("presence-status");
    const body = document.getElementById("presence-body");
    if (!dot || !label || !body) return;

    if (!isConfigured()) {
        renderUnavailable(label, dot, body, "presence not configured");
        return;
    }

    // render core page first; presence loads independently
    renderLoading(label, dot, body);
    connectWebSocket(label, dot, body);
}

function renderLoading(label, dot, body) {
    dot.className = "presence-dot presence-dot--offline";
    label.textContent = "checking presence...";
    body.innerHTML = '<p class="presence-card__muted">asking the presence service, one moment</p>';
}

function renderUnavailable(label, dot, body, message = "presence unavailable") {
    dot.className = "presence-dot presence-dot--offline";
    label.textContent = "offline";
    body.innerHTML = `<p class="presence-card__muted">${escapeHtml(message)}</p>`;
}

// ---------------------------------------------------------------------------
// websocket path (preferred — lanyard pushes updates)
// ---------------------------------------------------------------------------
function connectWebSocket(label, dot, body) {
    try {
        ws = new WebSocket(LANYARD_WS);
    } catch {
        startRestFallback(label, dot, body);
        return;
    }

    const failoverTimer = setTimeout(() => {
        if (!socketOpen) {
            try { ws.close(); } catch { /* already closed */ }
        }
    }, 8000);

    ws.addEventListener("open", () => { socketOpen = true; });

    ws.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.op === 1 && msg.d && msg.d.heartbeat_interval) {
            clearTimeout(failoverTimer);
            reconnectDelay = 1000;
            ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: CONFIG.discordUserId } }));
            startHeartbeat(msg.d.heartbeat_interval);
            return;
        }

        if (msg.op === 0 && msg.t) {
            if (msg.t === "INIT_STATE" || msg.t === "PRESENCE_UPDATE") {
                const data = msg.d && msg.d.discord_status ? msg.d : null;
                if (data) {
                    lastData = data;
                    render(data, label, dot, body);
                }
            }
        }
    });

    ws.addEventListener("close", () => {
        socketOpen = false;
        stopHeartbeat();
        // if we never got any data, fall back to rest polling
        if (!lastData) {
            startRestFallback(label, dot, body);
        } else {
            scheduleReconnect(label, dot, body);
        }
    });

    ws.addEventListener("error", () => { /* close handler deals with it */ });
}

function startHeartbeat(interval) {
    stopHeartbeat();
    lastHeartbeat = Date.now();
    heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 3 }));
            lastHeartbeat = Date.now();
        }
    }, interval);
}

function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect(label, dot, body) {
    setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        connectWebSocket(label, dot, body);
    }, reconnectDelay);
}

// ---------------------------------------------------------------------------
// rest fallback
// ---------------------------------------------------------------------------
function startRestFallback(label, dot, body) {
    if (restTimer) return;
    fetchRestOnce(label, dot, body);
    restTimer = setInterval(() => fetchRestOnce(label, dot, body), REST_FALLBACK_INTERVAL);
}

async function fetchRestOnce(label, dot, body) {
    try {
        const res = await fetch(`${LANYARD_REST}/${CONFIG.discordUserId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        if (json && json.success && json.data) {
            lastData = json.data;
            render(json.data, label, dot, body);
        }
    } catch {
        // keep showing whatever we last had; only show unavailable if we never got data
        if (!lastData) renderUnavailable(label, dot, body);
    }
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function render(data, label, dot, body) {
    const status = data.discord_status || "offline";
    dot.className = `presence-dot presence-dot--${status}`;
    label.textContent = STATUS_LABELS[status] || status;

    body.innerHTML = "";

    const primary = pickPrimaryActivity(data);

    if (!primary && !hasCustomStatus(data)) {
        if (status === "offline") {
            body.innerHTML = '<p class="presence-card__muted">not around right now</p>';
        } else {
            body.innerHTML = '<p class="presence-card__muted">here, just not doing anything reportable</p>';
        }
        return;
    }

    if (primary) {
        body.appendChild(buildActivityRow(primary, status));
    } else if (hasCustomStatus(data)) {
        const row = document.createElement("div");
        row.className = "activity";
        const custom = document.createElement("p");
        custom.className = "activity__custom";
        custom.textContent = data.discord_custom_status.state;
        custom.title = data.discord_custom_status.state;
        row.appendChild(custom);
        body.appendChild(row);
    }
}

function hasCustomStatus(data) {
    return !!(data.discord_custom_status && data.discord_custom_status.state);
}

// choose the single most interesting activity — no clutter.
function pickPrimaryActivity(data) {
    const activities = (data.activities || []).filter(
        (a) => a.type !== 4 // 4 = custom status, handled separately
    );
    if (activities.length === 0) return null;

    // prefer spotify, then game, then whatever's first
    if (data.spotify) {
        return { kind: "spotify", spotify: data.spotify, startedAt: data.spotify.timestamps ? data.spotify.timestamps.start : null };
    }
    const game = activities.find((a) => a.type === 0);
    if (game) return { kind: "game", activity: game };
    const watching = activities.find((a) => a.type === 3);
    if (watching) return { kind: "watching", activity: watching };
    const competing = activities.find((a) => a.type === 5);
    if (competing) return { kind: "competing", activity: competing };
    return { kind: "generic", activity: activities[0] };
}

const KIND_PREFIX = {
    spotify: "listening to",
    game: "playing",
    watching: "watching",
    competing: "competing in",
    generic: "",
};

function buildActivityRow(primary, status) {
    const row = document.createElement("div");
    row.className = "activity";

    const art = document.createElement("img");
    art.className = "activity__art";
    art.alt = "";
    art.loading = "lazy";
    if (primary.kind === "spotify") {
        art.src = primary.spotify.album_art_url;
    } else if (primary.activity.assets && primary.activity.assets.large_image) {
        art.src = assetUrl(primary.activity.assets.large_image, primary.activity.application_id);
    } else {
        art.src = fallbackArt();
    }
    art.addEventListener("error", () => { art.src = fallbackArt(); });

    const text = document.createElement("div");
    text.className = "activity__text";

    const name = document.createElement("p");
    name.className = "activity__name";

    if (primary.kind === "spotify") {
        const s = primary.spotify;
        name.textContent = `${s.song} — ${s.artist}`;
        name.title = `${s.song} — ${s.artist} · ${s.album}`;
    } else {
        const prefix = KIND_PREFIX[primary.kind];
        const detail = primary.activity.details ? ` · ${primary.activity.details}` : "";
        name.textContent = prefix ? `${prefix} ${primary.activity.name}` : primary.activity.name;
        name.title = primary.activity.name + (primary.activity.details ? ` — ${primary.activity.details}` : "");
    }

    const meta = document.createElement("p");
    meta.className = "activity__detail";

    if (primary.kind === "spotify" && primary.spotify.timestamps && primary.spotify.timestamps.start) {
        meta.className = "activity__time";
        meta.dataset.start = String(primary.spotify.timestamps.start);
    } else if (primary.activity && primary.activity.timestamps && primary.activity.timestamps.start) {
        meta.className = "activity__time";
        meta.dataset.start = String(primary.activity.timestamps.start);
    } else {
        meta.textContent = status === "offline" ? "" : "now";
    }

    text.appendChild(name);
    text.appendChild(meta);
    row.appendChild(art);
    row.appendChild(text);
    body.appendChild(row);

    tickElapsed();
    return row;
}

// resolve discord asset ids (spotify uses external urls already)
function assetUrl(image, applicationId) {
    if (!image) return fallbackArt();
    if (image.startsWith("mpx:external/")) {
        const path = image.replace("mpx:", "");
        return `https://media.discordapp.net/external/${path}`;
    }
    if (image.startsWith("external/")) {
        return `https://media.discordapp.net/external/${image.replace("external/", "")}`;
    }
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${image}.png`;
}

// tiny inline svg data-uri: a muted emerald square — quiet fallback for missing art
function fallbackArt() {
    return "data:image/svg+xml," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="#0d1411"/><path d="M13 13 L21 20 L13 27" fill="none" stroke="#2b6b52" stroke-width="3" stroke-linecap="round"/></svg>`
    );
}

// elapsed timer — computed locally from the start timestamp, not re-fetched
function tickElapsed() {
    const timers = document.querySelectorAll(".activity__time[data-start]");
    timers.forEach((el) => {
        const start = parseInt(el.dataset.start, 10);
        if (!start) return;
        const elapsed = Date.now() - start;
        el.textContent = elapsed > 0 ? `for ${formatElapsed(elapsed)}` : "just started";
    });
}

function formatElapsed(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes >= 1) return `${minutes}m`;
    return "moments";
}

setInterval(tickElapsed, 30 * 1000);

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
