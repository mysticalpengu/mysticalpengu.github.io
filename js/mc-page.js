// mc-page.js — mc page entry.

import { CONFIG } from "./config.js";
import { initChrome } from "./common.js";
import { initMcPage } from "./mc.js";
import { initMcControl } from "./mc-control.js";

initChrome();

const addressText = document.getElementById("mc-address-text");
if (addressText) {
    const addr = CONFIG.mcServerDisplay || CONFIG.mcServerAddress || "";
    addressText.textContent = addr.startsWith("YOUR_") ? "set mcServerAddress in js/config.js" : addr;
}

initMcPage();
initMcControl();
