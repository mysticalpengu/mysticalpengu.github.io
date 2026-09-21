// presence.js — live Discord presence via Lanyard.
// rendered orangci-style: a status dot beside the name, the custom status
// as an italic line, and a small muted activity line. websocket first,
// rest fallback, calm degradation on failure.

import { CONFIG } from "./config.js";

const LANYARD_WS = "wss://api.lanyard.rest/socket";
const LANYARD_REST = "https://api.lanyard.rest/v1/users";
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const REST_FALLBACK_INTERVAL = 60 * 1000;

const STATUS_TITLES = {
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

function isConfigured() {
    return CONFIG.discordUserId && !CONFIG.discordUserId.startsWith("YOUR_");
}

export function initPresence() {
    const dot = document.getElementById("presence-dot");
    if (!dot) return;

    if (!isConfigured()) {
        setDot(dot, "offline");
        return;
    }

    setDot(dot, "offline");
    const custom = document.getElementById("presence-custom");
    if (custom) custom.textContent = "checking presence...";

    connectWebSocket(dot);
}

function setDot(dot, status) {
    dot.className = `presence-dot presence-dot--${status}`;
    dot.title = STATUS_TITLES[status] || status;
}

// ---------------------------------------------------------------------------
// websocket path (push updates, no polling)
// ---------------------------------------------------------------------------
function connectWebSocket(dot) {
    try {
        ws = new WebSocket(LANYARD_WS);
    } catch {
        startRestFallback(dot);
        return;
    }

    const failoverTimer = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        try { ws.close(); } catch { /* already closed */ }
    }, 8000);

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

        if (msg.op === 0 && (msg.t === "INIT_STATE" || msg.t === "PRESENCE_UPDATE")) {
            const data = msg.d && msg.d.discord_status ? msg.d : null;
            if (data) {
                lastData = data;
                render(data, dot);
            }
        }
    });

    ws.addEventListener("close", () => {
        stopHeartbeat();
        if (!lastData) startRestFallback(dot);
        else scheduleReconnect(dot);
    });

    ws.addEventListener("error", () => { /* close handler deals with it */ });
}

function startHeartbeat(interval) {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 3 }));
        }
    }, interval);
}

function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect(dot) {
    setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        connectWebSocket(dot);
    }, reconnectDelay);
}

// ---------------------------------------------------------------------------
// rest fallback
// ---------------------------------------------------------------------------
function startRestFallback(dot) {
    if (restTimer) return;
    fetchRestOnce(dot);
    restTimer = setInterval(() => fetchRestOnce(dot), REST_FALLBACK_INTERVAL);
}

async function fetchRestOnce(dot) {
    try {
        const res = await fetch(`${LANYARD_REST}/${CONFIG.discordUserId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        if (json && json.success && json.data) {
            lastData = json.data;
            render(json.data, dot);
        }
    } catch {
        // keep showing whatever we last had
    }
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function render(data, dot) {
    const status = data.discord_status || "offline";
    setDot(dot, status);

    const customEl = document.getElementById("presence-custom");
    const activityEl = document.getElementById("presence-activity");

    const customStatus = (data.activities || []).find((a) => a.type === 4);

    if (customEl) {
        if (customStatus && customStatus.state) {
            customEl.hidden = false;
            customEl.textContent = customStatus.state;
            customEl.title = customStatus.state;
        } else {
            customEl.hidden = true;
            customEl.textContent = "";
        }
    }

    if (!activityEl) return;

    const primary = pickPrimaryActivity(data);
    if (!primary) {
        activityEl.hidden = true;
        activityEl.textContent = "";
        return;
    }

    activityEl.hidden = false;

    if (primary.kind === "spotify") {
        const s = primary.spotify;
        activityEl.innerHTML = "";
        activityEl.append(`listening to `);
        const a = document.createElement("span");
        a.className = "identity__activity-name";
        a.textContent = `${s.song} — ${s.artist}`;
        activityEl.appendChild(a);
        if (s.timestamps && s.timestamps.start) {
            activityEl.dataset.start = String(s.timestamps.start);
        } else {
            delete activityEl.dataset.start;
        }
    } else {
        const prefix = { game: "playing", watching: "watching", competing: "competing in", generic: "" }[primary.kind];
        activityEl.innerHTML = "";
        activityEl.append(prefix ? `${prefix} ` : "");
        const a = document.createElement("span");
        a.className = "identity__activity-name";
        a.textContent = primary.activity.name;
        activityEl.appendChild(a);
        if (primary.activity.details) {
            const d = document.createElement("span");
            d.className = "identity__activity-detail";
            d.textContent = ` · ${primary.activity.details}`;
            activityEl.appendChild(d);
        }
        if (primary.activity.timestamps && primary.activity.timestamps.start) {
            activityEl.dataset.start = String(primary.activity.timestamps.start);
        } else {
            delete activityEl.dataset.start;
        }
    }

    tickElapsed();
}

// choose the single most interesting activity — no clutter.
function pickPrimaryActivity(data) {
    if (data.spotify) {
        return { kind: "spotify", spotify: data.spotify };
    }
    const activities = (data.activities || []).filter((a) => a.type !== 4);
    const game = activities.find((a) => a.type === 0);
    if (game) return { kind: "game", activity: game };
    const watching = activities.find((a) => a.type === 3);
    if (watching) return { kind: "watching", activity: watching };
    const competing = activities.find((a) => a.type === 5);
    if (competing) return { kind: "competing", activity: competing };
    return null;
}

// elapsed timer — computed locally from the start timestamp, not re-fetched
function tickElapsed() {
    document.querySelectorAll("#presence-activity[data-start]").forEach((el) => {
        const start = parseInt(el.dataset.start, 10);
        if (!start) return;
        const elapsed = Date.now() - start;
        if (elapsed <= 0) return;
        let suffix = el.querySelector(".activity__elapsed");
        if (!suffix) {
            suffix = document.createElement("span");
            suffix.className = "activity__elapsed";
            el.appendChild(suffix);
        }
        suffix.textContent = ` · ${formatElapsed(elapsed)}`;
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
