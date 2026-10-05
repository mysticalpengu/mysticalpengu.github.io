// mc-control.js — start / stop buttons on the mc page.
// talks to pc/mc_controller.py running on the pc (url = CONFIG.mcControlUrl).
// the controller does the password check; nothing secret lives in this file.

import { CONFIG } from "./config.js";
import { showToast } from "./ui.js";

const POLL_MS = 5 * 1000;
const WATCH_MS = 3 * 60 * 1000;     // keep polling this long after a start/stop
const TIMEOUT_MS = 6 * 1000;

const LABELS = {
    offline: "server is off",
    starting: "starting... give it a minute",
    online: "server is on",
    stopping: "stopping... saving the world first",
};

const base = () => String(CONFIG.mcControlUrl || "").replace(/\/+$/, "");
const configured = () => base() !== "" && !base().startsWith("YOUR_");

async function call(path, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${base()}${path}`, { ...options, signal: ctrl.signal });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } finally {
        clearTimeout(timer);
    }
}

export function initMcControl() {
    const box = document.getElementById("mc-control");
    if (!box || !configured()) return;
    box.hidden = false;

    const pass = document.getElementById("mc-control-pass");
    const startBtn = document.getElementById("mc-start");
    const stopBtn = document.getElementById("mc-stop");
    const stateEl = document.getElementById("mc-control-state");

    let watchUntil = 0;
    let busy = false;

    const render = (text) => { stateEl.textContent = text; };

    async function refresh() {
        try {
            const { ok, data } = await call("/status");
            render(ok && LABELS[data.status] ? LABELS[data.status] : "controller gave a weird answer");
        } catch {
            render("pc is off, or the controller isn't running");
        }
    }

    function setBusy(value) {
        busy = value;
        startBtn.disabled = value;
        stopBtn.disabled = value;
    }

    async function act(action) {
        if (busy) return;
        if (!pass.value) {
            showToast("enter the password");
            pass.focus();
            return;
        }

        setBusy(true);
        try {
            const { ok, data } = await call(`/${action}`, {
                method: "POST",
                headers: { "X-Password": pass.value },
            });
            if (!ok) {
                render(data.error || "something went wrong");
                return;
            }
            showToast(data.message || "done");
            watchUntil = Date.now() + WATCH_MS;
            render(LABELS[data.status] || "");
        } catch {
            render("couldn't reach the pc");
        } finally {
            setBusy(false);
        }
    }

    startBtn.addEventListener("click", () => act("start"));
    stopBtn.addEventListener("click", () => act("stop"));
    pass.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

    // only ping the pc while the panel is open or right after an action,
    // so ordinary visitors never hit it
    box.addEventListener("toggle", () => { if (box.open) refresh(); });
    setInterval(() => {
        if (document.hidden || busy) return;
        if (box.open || Date.now() < watchUntil) refresh();
    }, POLL_MS);
}
