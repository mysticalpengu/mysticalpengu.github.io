// mc-page.js — mc page entry.

import { CONFIG } from "./config.js";
import { initMcPage, fetchStatus } from "./mc.js";

const user = (CONFIG.username || "").toLowerCase() || "mythicalpengu";

const footerUser = document.getElementById("footer-user");
if (footerUser) footerUser.textContent = user;

const footerYear = document.getElementById("footer-year");
if (footerYear) footerYear.textContent = new Date().getFullYear();

const pathUser = document.querySelector(".topbar__user");
if (pathUser) pathUser.textContent = `/${user}`;

const addressText = document.getElementById("mc-address-text");
if (addressText) {
    const addr = CONFIG.mcServerDisplay || CONFIG.mcServerAddress || "";
    addressText.textContent = addr.startsWith("YOUR_") ? "set mcServerAddress in js/config.js" : addr;
}

initMcPage();
