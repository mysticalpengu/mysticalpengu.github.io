// common.js — page chrome shared by every page: username, year, palette.

import { CONFIG } from "./config.js";
import { initPalette } from "./commands.js";

export const siteUser = () => (CONFIG.username || "").toLowerCase() || "mythicalpengu";

export function initChrome() {
    const user = siteUser();

    document.querySelectorAll(".topbar__user").forEach((el) => { el.textContent = `/${user}`; });

    const footerUser = document.getElementById("footer-user");
    if (footerUser) footerUser.textContent = user;

    const footerYear = document.getElementById("footer-year");
    if (footerYear) footerYear.textContent = new Date().getFullYear();

    initPalette();
}
