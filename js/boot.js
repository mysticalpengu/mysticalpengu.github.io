// boot.js — the signature terminal session opener.
// plays once per browsing session; skippable with any key/click;
// shortened for reduced-motion users; replayable via the command palette.

import { safeStorage } from "./safe-storage.js";

const BOOT_STORAGE_KEY = "boot:seen";
const FORCE_PARAM = "boot";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// stage definitions: [echo line, status label]
// status column fills right-aligned while the echo types out.
function buildStages(username) {
    return [
        { echo: "[ local session ]", status: "", dim: true },
        { echo: `mounting /home/${username}`, status: "ok" },
        { echo: "reading identity", status: "ok" },
        { echo: "checking presence", status: "ok" },
        { echo: "warming up the notes service", status: "ready" },
        { echo: "deciding on a font", status: "done" },
        { echo: "opening interface", status: "started" },
        { echo: "", status: "", blank: true },
        { echo: "session ready", status: "", dim: true },
    ];
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersSkip() {
    // ?boot=1 forces a replay even within the same session
    const params = new URLSearchParams(window.location.search);
    if (params.get(FORCE_PARAM) === "1") {
        params.delete(FORCE_PARAM);
        const clean = params.toString();
        window.history.replaceState({}, "", clean ? `?${clean}` : window.location.pathname);
        return false;
    }
    // play fully once per browsing session; instant pass-through afterwards
    return safeStorage.get(BOOT_STORAGE_KEY) === "session";
}

function markSeen() {
    safeStorage.set(BOOT_STORAGE_KEY, "session");
}

export async function playBoot(username) {
    const overlay = document.getElementById("boot");
    const log = document.getElementById("boot-log");
    if (!overlay || !log) return;

    const shouldSkip = prefersSkip();
    if (shouldSkip) return;

    markSeen();
    overlay.hidden = false;
    overlay.removeAttribute("aria-hidden");

    let skipped = false;
    const finishSkip = () => { skipped = true; };
    const skipEvents = ["keydown", "click", "touchstart"];

    const onKey = (e) => {
        if (["Enter", "Escape", " ", "Space"].includes(e.key) || e.key.length === 1) finishSkip();
    };
    skipEvents.forEach((ev) => window.addEventListener(ev, onKey, { once: false, passive: true }));

    const cleanup = () => {
        skipEvents.forEach((ev) => window.removeEventListener(ev, onKey));
    };

    const addLine = (text, status, dim, blank) => {
        const line = document.createElement("div");
        line.className = "boot__line" + (dim ? " boot__line--dim" : "");
        if (blank) line.style.minHeight = "1.4em";
        line.textContent = text || "";
        if (status) {
            const pad = Math.max(2, 44 - (text || "").length);
            const span = document.createElement("span");
            span.className = "boot__status";
            span.textContent = " ".repeat(pad) + status;
            line.appendChild(span);
            line.classList.add("boot__line--ok");
        }
        log.appendChild(line);
        return line;
    };

    const stages = buildStages(username);

    if (reducedMotion) {
        // no typing, one static frame, brief pause, done
        for (const stage of stages) {
            addLine(stage.echo, stage.status, stage.dim, stage.blank);
        }
        await wait(600);
        cleanup();
        closeOverlay(overlay);
        return;
    }

    const sleep = (ms) => new Promise((r) => {
        const t = setTimeout(r, ms);
        const check = setInterval(() => {
            if (skipped) { clearTimeout(t); clearInterval(check); r(); }
        }, 40);
    });

    for (const stage of stages) {
        if (skipped) break;

        if (stage.blank) {
            addLine("", "", false, true);
            await sleep(120);
            continue;
        }

        const line = addLine("", "", stage.dim);
        const textNode = document.createTextNode("");
        line.insertBefore(textNode, line.querySelector(".boot__status"));

        // type the echo text character by character
        for (let i = 0; i < stage.echo.length; i++) {
            if (skipped) { textNode.textContent = stage.echo; break; }
            textNode.textContent += stage.echo[i];
            await sleep(stage.dim ? 12 : 8 + Math.random() * 14);
        }
        if (skipped) { textNode.textContent = stage.echo; continue; }

        // status pops in after a beat
        if (stage.status) {
            await sleep(60 + Math.random() * 120);
            const pad = Math.max(2, 44 - stage.echo.length);
            const span = document.createElement("span");
            span.className = "boot__status";
            span.textContent = " ".repeat(pad) + stage.status;
            line.textContent = stage.echo;
            line.appendChild(span);
            line.classList.add("boot__line--ok");
        }

        await sleep(stage.dim ? 200 : 90 + Math.random() * 120);
    }

    // final prompt, then hand over
    if (!skipped) {
        await sleep(300);
        const prompt = document.createElement("div");
        prompt.className = "boot__line boot__promptline";
        prompt.textContent = ">_";
        log.appendChild(prompt);
        await sleep(500);
    }

    cleanup();
    closeOverlay(overlay);
}

function closeOverlay(overlay) {
    overlay.classList.add("is-done");
    overlay.setAttribute("aria-hidden", "true");
    setTimeout(() => { overlay.hidden = true; }, 450);
}
