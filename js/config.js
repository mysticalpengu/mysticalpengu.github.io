const CONFIG = {
    username: "mythicalpengu",
    displayName: "",
    title: "This is my website!",
    description: "I do things",

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

    profileImage: "",

    footerLine: "built with questionable amounts of coffee",

    devMode: false,
};

function checkConfig(devMode) {
    const missing = Object.entries(CONFIG)
        .filter(([key, value]) => key !== "profileImage" && key !== "displayName" && typeof value === "string" && value.startsWith("YOUR_"))
        .map(([key]) => key);

    if (missing.length === 0) return true;

    if (devMode) {
        console.warn("[config] unconfigured:", missing.join(", "));
    }
    return false;
}

export { CONFIG, checkConfig };
