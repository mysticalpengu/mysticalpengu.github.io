// main.js — landing page entry.

import { CONFIG, checkConfig } from "./config.js";
import { playBoot } from "./boot.js";
import { initChrome, siteUser } from "./common.js";
import { initPresence } from "./presence.js";
import { initMcWidget } from "./mc.js";
import { copyText, showToast } from "./ui.js";

const isSet = (v) => typeof v === "string" && v !== "" && !v.startsWith("YOUR_");

initChrome();
applyConfig();
initPresence();
initMcWidget();

// boot plays after the core page is in place
playBoot();

// dev-only config warning
if (CONFIG.devMode && !checkConfig(true)) {
    const note = document.createElement("div");
    note.className = "toast";
    note.textContent = "config incomplete — edit js/config.js";
    document.body.appendChild(note);
}

// the greeting, title, description and footer text live in index.html — edit them there.
// this only fills in the parts that come from config.
function applyConfig() {
    const user = siteUser();

    const path = document.getElementById("identity-path");
    if (path) path.textContent = `/home/${user}`;

    buildLinks();

    // owner entry point (subtle): goes straight to the login box
    const ownerLink = document.getElementById("owner-link");
    if (ownerLink && isSet(CONFIG.notesApi)) {
        ownerLink.hidden = false;
        ownerLink.href = "notes.html#login";
    }
}

function buildLinks() {
    const links = document.getElementById("links-list");
    if (!links) return;

    const items = [];

    if (isSet(CONFIG.wynnpoolUrl)) {
        items.push({ label: "wynnpool", href: CONFIG.wynnpoolUrl, external: true });
    }
    if (isSet(CONFIG.minecraftUrl)) {
        items.push({ label: "minecraft", href: CONFIG.minecraftUrl, external: true });
    } else {
        items.push({ label: "minecraft", href: "mc.html" });
    }
    if (isSet(CONFIG.discordUsername)) {
        items.push({
            label: "discord",
            action: async () => {
                const ok = await copyText(CONFIG.discordUsername);
                showToast(ok ? "copied" : "couldn't copy");
            },
        });
    }
    if (isSet(CONFIG.email)) {
        items.push({ label: "email", href: `mailto:${CONFIG.email}` });
    }

    // nothing configured → leave the static fallback list from the html alone
    if (items.length === 0) return;

    links.innerHTML = "";
    for (const item of items) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "link-cmd";
        a.textContent = item.label;

        if (item.href) {
            a.href = item.href;
            if (item.external) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                const hint = document.createElement("span");
                hint.className = "link-cmd__hint";
                hint.setAttribute("aria-hidden", "true");
                hint.textContent = " ↗";
                a.appendChild(hint);
            }
        } else {
            a.href = "#";
            a.title = "click to copy";
            a.addEventListener("click", (e) => { e.preventDefault(); item.action(); });
        }

        li.appendChild(a);
        links.appendChild(li);
    }
}
