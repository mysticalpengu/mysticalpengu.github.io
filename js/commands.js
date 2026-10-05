// commands.js — command palette (ctrl+k), available on every page.

import { CONFIG } from "./config.js";
import { copyText, showToast, openDialog, closeDialog } from "./ui.js";

const PALETTE_HTML = `
    <div class="palette__backdrop" data-palette-close></div>
    <div class="palette__panel" role="dialog" aria-modal="true" aria-label="command palette">
        <div class="palette__input-row">
            <span class="palette__prompt" aria-hidden="true">&gt;</span>
            <input id="palette-input" class="palette__input" type="text" placeholder="type a command..."
                   autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true"
                   aria-controls="palette-list" aria-autocomplete="list" aria-label="command">
        </div>
        <ul class="palette__list" id="palette-list" role="listbox" aria-label="commands"></ul>
        <div class="palette__hint">enter to run · esc to close</div>
    </div>`;

let paletteOpen = false;
let activeIndex = 0;
let filtered = [];

const isSet = (v) => typeof v === "string" && v !== "" && !v.startsWith("YOUR_");

function commands() {
    const cmds = [
        { name: "home", hint: "index.html", run: () => navigate("index.html") },
        { name: "about", hint: "about.html", run: () => navigate("about.html") },
        { name: "mc", hint: "mc.html", run: () => navigate("mc.html") },
        { name: "notes", hint: "notes.html", run: () => navigate("notes.html") },
        { name: "replay boot", hint: "?boot=1", run: () => navigate("index.html?boot=1") },
    ];

    if (isSet(CONFIG.notesApi)) {
        cmds.push({ name: "owner login", hint: "notes.html", run: () => navigate("notes.html#login") });
    }
    if (isSet(CONFIG.discordUsername)) {
        cmds.push({
            name: "copy discord",
            hint: CONFIG.discordUsername,
            run: async () => {
                const ok = await copyText(CONFIG.discordUsername);
                showToast(ok ? "copied" : "couldn't copy");
            },
        });
    }
    if (isSet(CONFIG.email)) {
        cmds.push({ name: "email", hint: "mailto", run: () => { window.location.href = `mailto:${CONFIG.email}`; } });
    }
    if (isSet(CONFIG.wynnpoolUrl)) {
        cmds.push({ name: "wynnpool", hint: "↗", run: () => window.open(CONFIG.wynnpoolUrl, "_blank", "noopener") });
    }
    if (isSet(CONFIG.minecraftUrl)) {
        cmds.push({ name: "minecraft", hint: "↗", run: () => window.open(CONFIG.minecraftUrl, "_blank", "noopener") });
    }
    return cmds;
}

function navigate(url) {
    showToast("opening...");
    setTimeout(() => { window.location.href = url; }, 200);
}

export function initPalette() {
    let palette = document.getElementById("palette");
    if (!palette) {
        palette = document.createElement("div");
        palette.id = "palette";
        palette.className = "palette";
        palette.hidden = true;
        palette.innerHTML = PALETTE_HTML;
        document.body.appendChild(palette);
    }

    const input = document.getElementById("palette-input");
    const list = document.getElementById("palette-list");
    if (!input || !list) return;

    window.addEventListener("keydown", (e) => {
        const key = (e.key || "").toLowerCase();
        if ((e.ctrlKey || e.metaKey) && key === "k") {
            e.preventDefault();
            paletteOpen ? closePalette() : openPalette();
            return;
        }
        if (key === "escape" && paletteOpen) {
            e.preventDefault();
            e.stopPropagation();
            closePalette();
        }
    }, true);

    palette.addEventListener("click", (e) => {
        if (e.target.closest("[data-palette-close]")) closePalette();
    });

    input.addEventListener("input", () => renderList(input.value));
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") { e.preventDefault(); runActive(); }
    });

    function move(delta) {
        if (filtered.length === 0) return;
        activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
        highlight();
    }

    function runActive() {
        const cmd = filtered[activeIndex] || filtered[0];
        if (!cmd) return;
        closePalette();
        cmd.run();
    }

    function highlight() {
        [...list.children].forEach((el, i) => {
            const active = i === activeIndex;
            el.classList.toggle("is-active", active);
            el.setAttribute("aria-selected", String(active));
            if (active) {
                input.setAttribute("aria-activedescendant", el.id);
                el.scrollIntoView({ block: "nearest" });
            }
        });
    }

    function renderList(query = "") {
        const all = commands();
        const q = query.trim().toLowerCase();
        filtered = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
        activeIndex = 0;
        list.innerHTML = "";
        input.removeAttribute("aria-activedescendant");

        if (filtered.length === 0) {
            const empty = document.createElement("li");
            empty.className = "palette__empty";
            empty.textContent = "no such command";
            list.appendChild(empty);
            return;
        }

        filtered.forEach((cmd, i) => {
            const li = document.createElement("li");
            li.className = "palette__item";
            li.id = `palette-opt-${i}`;
            li.setAttribute("role", "option");
            const name = document.createElement("span");
            name.textContent = cmd.name;
            const hint = document.createElement("kbd");
            hint.textContent = cmd.hint;
            li.appendChild(name);
            li.appendChild(hint);
            li.addEventListener("click", () => { closePalette(); cmd.run(); });
            li.addEventListener("mousemove", () => {
                if (activeIndex !== i) { activeIndex = i; highlight(); }
            });
            list.appendChild(li);
        });
        highlight();
    }

    function openPalette() {
        paletteOpen = true;
        input.value = "";
        renderList();
        openDialog(palette, input);
    }

    function closePalette() {
        paletteOpen = false;
        closeDialog(palette);
    }
}
