// config.js — personal settings live here.
// the visible page text (greeting, title, description, footer lines) is written
// directly in the html files, so there is only one place to edit it.

const CONFIG = {
    username: "mythicalpengu",

    // the real address of the site (shown in the boot animation)
    siteHost: "mysticalpengu.github.io",

    discordUserId: "1497173080131371048",
    discordUsername: "mythicalpengu",

    email: "mythicalpengu@proton.me",

    wynnpoolUrl: "https://www.wynnpool.com/stats/player/9c054573-866c-4b09-89ab-f40c936a9ebd",
    minecraftUsername: "mythicalpengu",
    minecraftUrl: "https://namemc.com/profile/mythicalpengu.2",

    // notes backend base url (the cloudflare worker)
    notesApi: "https://mythicalpengu-notes.mysticalpengu.workers.dev",

    // minecraft server — address used for the status widget (ip or hostname[:port])
    mcServerAddress: "YOUR_MC_SERVER_ADDRESS",

    // what shows as the copy address on the mc page; defaults to mcServerAddress
    mcServerDisplay: "",

    // url of pc/mc_controller.py (the start/stop panel talks to it).
    // leave as YOUR_... and the panel stays hidden
    mcControlUrl: "play.creativefun.com",

    devMode: false,
};

// keys that are fine to leave empty / unset
const OPTIONAL_KEYS = new Set(["mcServerDisplay", "mcControlUrl"]);

function checkConfig(devMode) {
    const missing = Object.entries(CONFIG)
        .filter(([key, value]) =>
            !OPTIONAL_KEYS.has(key) && typeof value === "string" && value.startsWith("YOUR_"))
        .map(([key]) => key);

    if (missing.length === 0) return true;

    if (devMode) {
        console.warn("[config] unconfigured:", missing.join(", "));
    }
    return false;
}

export { CONFIG, checkConfig };
