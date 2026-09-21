// boot.js — a scripted shell session that "installs" the website,
// stef-style: real-looking prompt, typing with the occasional typo that
// gets corrected mid-line, apt output, a deploy progress bar.
// plays once per browsing session; skippable with any key/click;
// replayable via the command palette (?boot=1).

import { safeStorage } from "./safe-storage.js";

const BOOT_STORAGE_KEY = "boot:seen";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const USER = "pengu";
const HOST = "mythicalpengu.github.io";

// the script. ops:
//   prompt            → new line, colored "user@host:~$ " ready for typing
//   type              → typed character by character (speed in ms/char)
//   say               → output line, appears instantly (with a beat before)
//   del               → delete n characters from current line
//   pause             → wait
//   bar               → animated install progress bar on its own line
function buildScript() {
    const P = { t: "prompt" };
    return [
        P,
        { t: "type", text: `ssh ${USER}@${HOST}`, speed: 35 },
        { t: "say", text: "The authenticity of host 'mythicalpengu.github.io' can't be established." },
        { t: "say", text: "ED25519 key fingerprint is SHA256:wAddLeP3nGu1sR3aLLyC00l." },
        { t: "say", text: "Are you sure you want to continue connecting (yes/no/[fingerprint])?" },
        P,
        { t: "type", text: "yes", speed: 120 },
        { t: "say", text: `Warning: Permanently added '${HOST}' (ED25519) to the list of known hosts.` },
        { t: "say", text: `${USER}@${HOST}'s password:` },
        P,
        { t: "type", text: "**********", speed: 90 },
        { t: "pause", ms: 700 },
        { t: "say", text: "access granted. welcome to the iceberg." },
        P,
        { t: "type", text: "sudo atp install mythicalpengu -y", speed: 30 },
        { t: "pause", ms: 600 },
        { t: "del", n: 3, speed: 40 },
        { t: "type", text: "pt install mythicalpengu -y", speed: 30 },
        { t: "say", text: "[sudo] password for pengu:" },
        P,
        { t: "type", text: "**********", speed: 90 },
        { t: "say", text: "Reading package lists... Done" },
        { t: "say", text: "Building dependency tree... Done" },
        { t: "say", text: "The following NEW packages will be installed:" },
        { t: "say", text: "  emerald-dark-mode discord-presence minecraft-server notes vibes" },
        { t: "say", text: "0 upgraded, 5 newly installed, 0 to remove and 0 not upgraded." },
        { t: "say", text: "Need to get 42 kB of archives." },
        { t: "say", text: "After this operation, 1 penguin of additional disk space will be used." },
        { t: "bar" },
        { t: "say", text: "Setting up mythicalpengu (latest) ..." },
        P,
        { t: "type", text: "waddle", speed: 60 },
        { t: "pause", ms: 800 },
        { t: "say", text: "waddle on over to mysticalpengu.github.io" },
        { t: "pause", ms: 900 },
    ];
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersSkip() {
    // ?boot=1 forces a replay even within the same session
    const params = new URLSearchParams(window.location.search);
    if (params.get("boot") === "1") {
        params.delete("boot");
        const clean = params.toString();
        window.history.replaceState({}, "", clean ? `?${clean}` : window.location.pathname);
        return false;
    }
    return safeStorage.get(BOOT_STORAGE_KEY) === "session";
}

function markSeen() {
    safeStorage.set(BOOT_STORAGE_KEY, "session");
}

const sleep = (ms) => new Promise((r) => {
    const t = setTimeout(r, ms);
    const check = setInterval(() => { if (state.skipped) { clearTimeout(t); clearInterval(check); r(); } }, 40);
});

const state = { skipped: false };

export async function playBoot() {
    const overlay = document.getElementById("boot");
    const log = document.getElementById("boot-log");
    if (!overlay || !log) return;

    if (prefersSkip()) return;
    markSeen();

    overlay.hidden = false;
    overlay.removeAttribute("aria-hidden");

    const finishSkip = () => { state.skipped = true; };
    const events = ["keydown", "click", "touchstart"];
    const onSkip = () => finishSkip();
    events.forEach((ev) => window.addEventListener(ev, onSkip, { passive: true }));

    const script = buildScript();
    let currentLine = null;

    const newLine = (html = "") => {
        const line = document.createElement("div");
        line.className = "boot__line";
        line.innerHTML = html;
        log.appendChild(line);
        return line;
    };

    const promptHtml = `<span class="boot__user">${USER}</span>@<span class="boot__host">${HOST}</span>:<span class="boot__path">~</span>$ `;

    async function runOp(op) {
        if (op.t === "prompt") {
            currentLine = newLine(promptHtml);
            await sleep(op.delay ?? 400);
            return;
        }

        if (op.t === "say") {
            const line = newLine("");
            // output lines render without a prompt — dimmer text
            line.className = "boot__line boot__line--out";
            line.textContent = op.text;
            await sleep(state.skipped ? 0 : (op.delay ?? 120) + Math.random() * 80);
            return;
        }

        if (op.t === "type") {
            if (!currentLine || currentLine.dataset.done) currentLine = newLine(promptHtml);
            const span = document.createElement("span");
            currentLine.appendChild(span);
            for (const ch of op.text) {
                if (state.skipped) { span.textContent = op.text; break; }
                span.textContent += ch;
                await sleep(op.speed ?? 30);
            }
            return;
        }

        if (op.t === "del") {
            if (!currentLine) return;
            const span = currentLine.lastElementChild;
            if (!span) return;
            for (let i = 0; i < op.n; i++) {
                if (state.skipped) { span.textContent = span.textContent.slice(0, -op.n); break; }
                span.textContent = span.textContent.slice(0, -1);
                await sleep(op.speed ?? 40);
            }
            return;
        }

        if (op.t === "bar") {
            const line = newLine("");
            line.className = "boot__line boot__line--out";
            const text = document.createElement("span");
            line.appendChild(text);
            const steps = ["[----------------------]   0%", "[#####-----------------]  23%", "[############----------]  54%", "[##################----]  81%", "[######################] 100%"];
            for (const s of steps) {
                if (state.skipped) { text.textContent = steps[steps.length - 1]; break; }
                text.textContent = `Unpacking mythicalpengu ${s}`;
                await sleep(op.speed ?? 450);
            }
            await sleep(200);
            return;
        }

        if (op.t === "pause") {
            await sleep(state.skipped ? 0 : op.ms ?? 500);
        }
    }

    if (reducedMotion) {
        // static frame: dump the whole transcript instantly
        for (const op of script) {
            if (op.t === "prompt") { currentLine = newLine(promptHtml); }
            else if (op.t === "say" || op.t === "bar") {
                const line = newLine("");
                line.className = "boot__line boot__line--out";
                line.textContent = op.t === "bar" ? "Unpacking mythicalpengu [######################] 100%" : op.text;
            } else if (op.t === "type") {
                if (!currentLine) currentLine = newLine(promptHtml);
                const span = document.createElement("span");
                span.textContent = op.text;
                currentLine.appendChild(span);
            }
        }
        await wait(700);
        events.forEach((ev) => window.removeEventListener(ev, onSkip));
        closeOverlay(overlay);
        return;
    }

    for (const op of script) {
        await runOp(op);
    }

    events.forEach((ev) => window.removeEventListener(ev, onSkip));
    closeOverlay(overlay);
}

function closeOverlay(overlay) {
    overlay.classList.add("is-done");
    overlay.setAttribute("aria-hidden", "true");
    setTimeout(() => { overlay.hidden = true; }, 450);
}
