// config.js — personal settings live here.
// the visible page text (greeting, title, description, footer lines) is written
// directly in the html files, so there is only one place to edit it.

const CONFIG = {
    username: "mythicalpengu",

    // the main address of the site (shown in the boot animation)
    siteHost: "mythicalpengu.pages.dev",

    // every address that should reach the site. these are cloudflare pages custom domains
    // (each one's dns record is a CNAME to mythicalpengu.pages.dev). the notes api lists the
    // same origins in backend/wrangler.toml + wrangler.toml, so add new ones in all three places.
    domains: [
        "mythicalpengu.pages.dev",
        "mythicalpengu.is-a.dev",
        "mythicalpengu.is-my.id",
        "mythicalpengu.part-of.my.id",
        "mythicalpengu.is-not.cool",
        "mythicalpengu.is-a.bot",
        "mythicalpengu.is-a-fullstack.dev",
        "mythicalpengu.is-cool.dev",
        "mythicalpengu.is-local.org",
        "mythicalpengu.localplayer.dev",
        "mythicalpengu.living-the.life",
        "mythicalpengu.is-not-a.dev",
    ],

    discordUserId: "1497173080131371048",
    discordUsername: "mythicalpengu",

    email: "mythicalpengu@proton.me",

    wynnpoolUrl: "https://www.wynnpool.com/stats/player/9c054573-866c-4b09-89ab-f40c936a9ebd",
    minecraftUsername: "mythicalpengu",
    minecraftUrl: "https://namemc.com/profile/mythicalpengu.2",

    // notes backend base url (the cloudflare worker)
    notesApi: "https://mythicalpengu-notes.mysticalpengu.workers.dev",

    // minecraft server — address used for the status widget (ip or hostname[:port])
    mcServerAddress: "play.creativefun.com",

    devMode: false,
};

function checkConfig(devMode) {
    const missing = Object.entries(CONFIG)
        .filter(([, value]) => typeof value === "string" && value.startsWith("YOUR_"))
        .map(([key]) => key);

    if (missing.length === 0) return true;

    if (devMode) {
        console.warn("[config] unconfigured:", missing.join(", "));
    }
    return false;
}

export { CONFIG, checkConfig };
