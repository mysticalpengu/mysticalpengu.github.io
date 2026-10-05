// run with:  node --test test/playing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { minecraftPlaying } from "../js/playing.js";

const game = (extra) => ({ activities: [{ type: 0, name: "Minecraft", ...extra }] });

test("not playing minecraft → null", () => {
    assert.equal(minecraftPlaying(null), null);
    assert.equal(minecraftPlaying({}), null);
    assert.equal(minecraftPlaying({ activities: [] }), null);
    assert.equal(minecraftPlaying({ activities: [{ type: 0, name: "Roblox" }] }), null);
    assert.equal(minecraftPlaying({ activities: [{ type: 2, name: "Spotify" }] }), null);
    assert.equal(minecraftPlaying({ activities: [{ type: 4, name: "Custom Status", state: "minecraft" }] }), null);
});

test("plain minecraft activity → playing, no server text", () => {
    assert.deepEqual(minecraftPlaying(game({})), { text: "" });
});

test("details and state are passed through as-is", () => {
    assert.deepEqual(minecraftPlaying(game({ details: "Playing on play.creativefun.com", state: "Lobby" })),
        { text: "Playing on play.creativefun.com · Lobby" });
    assert.deepEqual(minecraftPlaying(game({ state: "play.creativefun.com" })), { text: "play.creativefun.com" });
});

test("duplicate and blank lines are dropped, name matching is case-insensitive", () => {
    assert.deepEqual(minecraftPlaying({ activities: [{ type: 0, name: "MINECRAFT 1.21", details: "x", state: "x" }] }), { text: "x" });
    assert.deepEqual(minecraftPlaying(game({ details: "  ", state: null })), { text: "" });
});
