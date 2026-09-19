const CONFIG = {
    username: "mythicalpengu",
    displayName: "",
    title: "YOUR_TITLE",
    description: "YOUR_DESCRIPTION",

    discordUserId: "1497173080131371048",
    discordUsername: "mythicalpengu",

    email: "mythicalpengu@proton.me",

    wynnpoolUrl: "https://www.wynnpool.com/stats/player/9c054573-866c-4b09-89ab-f40c936a9ebd",
    minecraftUsername: "mythicalpengu",
    minecraftUrl: "https://namemc.com/profile/mythicalpengu.2",

    notesApi: "https://mythicalpengu-notes.mysticalpengu.workers.dev",

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
