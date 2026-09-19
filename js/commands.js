// commands.js — command palette (ctrl+k) + terminal command handling.

import { CONFIG } from "./config.js";
import { copyText, showToast } from "./ui.js";

let paletteOpen = false;
let activeIndex = 0;
let filtered = [];

function commands() {
    const configured = (v) => v && !v.startsWith("YOUR_");
    const cmds = [
        { name: "home", hint: "index.html", run: () => navigate("index.html") },
        { name: "notes", hint: "notes.html", run: () => navigate("notes.html") },
        { name: "replay boot", hint: "?boot=1", run: () => navigate("index.html?boot=1") },
    ];

    if (configured(CONFIG.discordUsername)) {
        cmds.push({
            name: "copy discord",
            hint: CONFIG.discordUsername,
            run: async () => {
                await copyText(CONFIG.discordUsername);
                showToast("copied");
            },
        });
    }
    if (configured(CONFIG.email)) {
        cmds.push({ name: "email", hint: "mailto", run: () => { window.location.href = `mailto:${CONFIG.email}`; } });
    }
    if (configured(CONFIG.wynnpoolUrl)) {
        cmds.push({ name: "wynnpool", hint: "↗", run: () => window.open(CONFIG.wynnpoolUrl, "_blank", "noopener") });
    }
    if (configured(CONFIG.minecraftUrl)) {
        cmds.push({ name: "minecraft", hint: "↗", run: () => window.open(CONFIG.minecraftUrl, "_blank", "noopener") });
    }
    return cmds;
}

function navigate(url) {
    showToast("opening...");
    setTimeout(() => { window.location.href = url; }, 250);
}

export function initPalette() {
    const palette = document.getElementById("palette");
    const input = document.getElementById("palette-input");
    const list = document.getElementById("palette-list");
    if (!palette || !input || !list) return;

    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            paletteOpen ? closePalette() : openPalette();
            return;
        }
        if (e.key === "Escape" && paletteOpen) {
            e.preventDefault();
            closePalette();
        }
    });

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
            el.classList.toggle("is-active", i === activeIndex);
        });
    }

    function renderList(query = "") {
        const all = commands();
        const q = query.trim().toLowerCase();
        filtered = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
        activeIndex = 0;
        list.innerHTML = "";

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
            li.setAttribute("role", "option");
            const name = document.createElement("span");
            name.textContent = cmd.name;
            const hint = document.createElement("kbd");
            hint.textContent = cmd.hint;
            li.appendChild(name);
            li.appendChild(hint);
            li.addEventListener("click", () => { closePalette(); cmd.run(); });
            li.addEventListener("mousemove", () => { activeIndex = i; highlight(); });
            list.appendChild(li);
        });
        highlight();
    }

    function openPalette() {
        palette.hidden = false;
        paletteOpen = true;
        input.value = "";
        renderList();
        input.focus();
    }

    function closePalette() {
        palette.hidden = true;
        paletteOpen = false;
        input.blur();
    }
}
