// main.js — landing page entry.

import { CONFIG, checkConfig } from "./config.js";
import { playBoot } from "./boot.js";
import { initPresence } from "./presence.js";
import { initPalette } from "./commands.js";
import { copyText, showToast } from "./ui.js";

const configured = (v) => v && !v.startsWith("YOUR_");
const lower = (v) => (v || "").toLowerCase();

applyConfig();
initPalette();
initPresence();

// boot plays after first paint of the core page
playBoot(CONFIG.username);

// footer year
const year = document.getElementById("footer-year");
if (year) year.textContent = new Date().getFullYear();

// dev-only config warning
if (CONFIG.devMode && !checkConfig(true)) {
    const note = document.createElement("div");
    note.className = "toast";
    note.style.position = "fixed";
    note.style.top = "20px";
    note.textContent = "config incomplete — edit js/config.js";
    document.body.appendChild(note);
}

function applyConfig() {
    const user = lower(CONFIG.username) || "mythicalpengu";

    document.title = `~/${user}`;
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = `~/${user}`;

    setText("identity-path", `/home/${user}`);
    setText("identity-name", user);
    setText("identity-title", CONFIG.title);
    setText("identity-desc", CONFIG.description);
    setText("footer-user", user);
    setText("footer-line", CONFIG.footerLine);

    // topbar path
    const pathUser = document.querySelector(".topbar__user");
    if (pathUser) pathUser.textContent = `/${user}`;

    // links
    const links = document.getElementById("links-list");
    if (links) {
        links.innerHTML = "";
        const items = [];

        if (configured(CONFIG.wynnpoolUrl)) {
            items.push({ label: "wynnpool", href: CONFIG.wynnpoolUrl, external: true });
        }
        if (configured(CONFIG.minecraftUrl)) {
            items.push({ label: "minecraft", href: CONFIG.minecraftUrl, external: true });
        }
        if (configured(CONFIG.discordUsername)) {
            items.push({ label: "discord", action: async () => {
                const ok = await copyText(CONFIG.discordUsername);
                showToast(ok ? "copied" : "couldn't copy");
            }});
        }
        if (configured(CONFIG.email)) {
            items.push({ label: "email", href: `mailto:${CONFIG.email}` });
        }

        for (const item of items) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.className = "link-cmd";
            if (item.href) {
                a.href = item.href;
                if (item.external) {
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    a.innerHTML = `${item.label}<span class="link-cmd__hint" aria-hidden="true"> ↗</span>`;
                } else {
                    a.textContent = item.label;
                }
            } else {
                a.href = "#";
                a.textContent = item.label;
                a.addEventListener("click", (e) => { e.preventDefault(); item.action(); });
            }
            li.appendChild(a);
            links.appendChild(li);
        }
    }

    // owner entry point (subtle)
    const ownerLink = document.getElementById("owner-link");
    if (ownerLink && configured(CONFIG.notesApi)) {
        ownerLink.hidden = false;
        ownerLink.href = `notes.html`;
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
}
