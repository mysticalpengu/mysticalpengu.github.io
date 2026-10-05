// mc.js — minecraft server status via the mcstatus.io api.
// used on the landing page (tiny inline widget) and the mc page (full card).

import { CONFIG } from "./config.js";
import { copyText, showToast } from "./ui.js";
import { minecraftPlaying } from "./playing.js";

const STATUS_API = "https://api.mcstatus.io/v2/status/java/";
const REFRESH_MS = 60 * 1000;

const configured = () =>
    CONFIG.mcServerAddress && !String(CONFIG.mcServerAddress).startsWith("YOUR_");

function displayAddress() {
    return CONFIG.mcServerDisplay || CONFIG.mcServerAddress || "";
}

let cache = null;          // last successful payload
let cacheAt = 0;
let inflight = null;

// fetch with a short-lived cache so the landing widget + mc page
// never double-hammer the api on a single load
export async function fetchStatus() {
    if (cache && Date.now() - cacheAt < 30 * 1000) return cache;
    if (inflight) return inflight;

    if (!configured()) {
        return { unconfigured: true };
    }

    inflight = (async () => {
        try {
            const res = await fetch(`${STATUS_API}${encodeURIComponent(CONFIG.mcServerAddress)}`, {
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = await res.json();
            // normalize mcstatus.io v2 shape into what the widgets expect
            cache = {
                online: !!data.online,
                players: data.players || {},
                version: data.version ? data.version.name_clean || "" : "",
                motd: data.motd ? { clean: [data.motd.clean || ""] } : null,
            };
            cacheAt = Date.now();
            return cache;
        } catch {
            return { error: true };
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

// ---------------------------------------------------------------------------
// landing page widget: "● mc server: online · 3/20  →"
// while i'm actually playing (per discord), it shows that instead.
// ---------------------------------------------------------------------------
export function initMcWidget() {
    const widget = document.getElementById("mc-widget");
    if (!widget) return;

    const dot = document.getElementById("mc-dot");
    const label = document.getElementById("mc-label");
    const hint = document.getElementById("mc-hint");

    let live = null;     // what discord says i'm playing right now, or null
    let state = configured() ? { checking: true } : { unconfigured: true };

    window.addEventListener("presence:update", (e) => {
        live = minecraftPlaying(e.detail);
        render();
    });

    if (configured()) {
        fetchStatus().then((s) => { state = s; render(); });
        setInterval(async () => { state = await fetchStatus(); render(); }, REFRESH_MS);
    }
    render();

    function render() {
        if (!dot || !label) return;

        if (live) {
            widget.hidden = false;
            dot.className = "mc-widget__dot mc-widget__dot--up";
            dot.title = "playing right now";
            label.textContent = live.text ? `playing now · ${live.text}` : "playing minecraft now";
            if (hint) hint.textContent = "→";
            return;
        }

        if (state.unconfigured) { widget.hidden = true; return; }
        widget.hidden = false;

        if (state.checking) {
            dot.className = "mc-widget__dot mc-widget__dot--checking";
            label.textContent = "mc server: checking...";
            if (hint) hint.textContent = "";
            return;
        }

        if (state.error) {
            dot.className = "mc-widget__dot mc-widget__dot--down";
            label.textContent = "mc server: status unknown";
            if (hint) hint.textContent = "";
            return;
        }

        if (state.online) {
            const players = state.players && state.players.online != null
                ? ` · ${state.players.online}/${state.players.max}` : "";
            dot.className = "mc-widget__dot mc-widget__dot--up";
            dot.title = "server is online";
            label.textContent = `mc server: online${players}`;
            if (hint) hint.textContent = "→";
        } else {
            dot.className = "mc-widget__dot mc-widget__dot--down";
            dot.title = "server is offline";
            label.textContent = "mc server: offline";
            if (hint) hint.textContent = "→";
        }
    }
}

// ---------------------------------------------------------------------------
// mc page: full status card + join address copy
// ---------------------------------------------------------------------------
export function initMcPage() {
    const card = document.getElementById("mc-card");
    if (!card) return;

    const addressBtn = document.getElementById("mc-address");
    if (addressBtn && configured()) {
        addressBtn.addEventListener("click", async () => {
            const ok = await copyText(displayAddress());
            showToast(ok ? "copied" : "couldn't copy");
        });
    }

    paint({ checking: true });
    fetchStatus().then(paint);
    setInterval(async () => paint(await fetchStatus()), REFRESH_MS);

    function paint(state) {
        const dot = card.querySelector("#mc-page-dot");
        const statusText = card.querySelector("#mc-page-status");
        const meta = card.querySelector("#mc-page-meta");
        const motd = card.querySelector("#mc-page-motd");
        const playersEl = card.querySelector("#mc-page-players");
        const versionEl = card.querySelector("#mc-page-version");

        if (!configured()) {
            if (statusText) statusText.textContent = "no server configured";
            if (meta) meta.textContent = "set mcServerAddress in js/config.js";
            return;
        }

        if (state.checking) {
            if (dot) dot.className = "mc-widget__dot mc-widget__dot--checking";
            if (statusText) statusText.textContent = "checking server...";
            if (meta) meta.textContent = "";
            return;
        }

        if (state.error) {
            if (dot) dot.className = "mc-widget__dot mc-widget__dot--down";
            if (statusText) statusText.textContent = "status unknown";
            if (meta) meta.textContent = "couldn't reach the status api";
            return;
        }

        if (state.online) {
            if (dot) { dot.className = "mc-widget__dot mc-widget__dot--up"; dot.title = "online"; }
            if (statusText) statusText.textContent = "online";

            const p = state.players || {};
            if (playersEl) {
                playersEl.textContent = p.online != null
                    ? `${p.online} / ${p.max} players` : "";
            }
            if (versionEl) {
                const v = state.version || "";
                versionEl.textContent = v ? `running ${v}` : "";
            }
            if (motd) {
                // mcstatus.io already strips the § formatting codes into motd.clean
                const clean = (state.motd && state.motd.clean && state.motd.clean.join(" ")) || "";
                motd.textContent = clean ? `"${clean.trim()}"` : "";
                motd.hidden = !clean;
            }
            if (meta) meta.textContent = "";
        } else {
            if (dot) { dot.className = "mc-widget__dot mc-widget__dot--down"; dot.title = "offline"; }
            if (statusText) statusText.textContent = "offline";
            if (meta) meta.textContent = "probably restarting. or i forgot to pay for it.";
            if (motd) motd.hidden = true;
            if (playersEl) playersEl.textContent = "";
            if (versionEl) versionEl.textContent = "";
        }
    }
}
