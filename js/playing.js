// playing.js — "am i playing minecraft right now, and what does it say?"
//
// reads only what discord already shows publicly (via lanyard): if a minecraft
// activity is on, its details / state lines are returned as-is. nothing is guessed.
// whether the server name shows up depends on whether the game or launcher puts it
// into the discord status — discord itself only knows "Minecraft" otherwise.

export function minecraftPlaying(data) {
    const activities = (data && data.activities) || [];
    const game = activities.find((a) => a && a.type === 0 && /minecraft/i.test(a.name || ""));
    if (!game) return null;

    const lines = [game.details, game.state]
        .map((line) => String(line || "").trim())
        .filter(Boolean);

    return { text: [...new Set(lines)].join(" · ") };
}
