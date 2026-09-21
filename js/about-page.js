// about-page.js — about page entry. your content lives in about.html directly;
// this just wires the shared chrome (username, year, palette-less basics).

import { CONFIG } from "./config.js";

const user = (CONFIG.username || "").toLowerCase() || "mythicalpengu";

const footerUser = document.getElementById("footer-user");
if (footerUser) footerUser.textContent = user;

const footerYear = document.getElementById("footer-year");
if (footerYear) footerYear.textContent = new Date().getFullYear();

const pathUser = document.querySelector(".topbar__user");
if (pathUser) pathUser.textContent = `/${user}`;
