// safeStorage — localStorage that never throws
// some browsers (private mode, strict settings) deny localStorage entirely.
// the site must keep working when it does.

const memory = new Map();
let available = null;

function detect() {
    if (available !== null) return available;
    try {
        const probe = "__probe__";
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
        available = true;
    } catch {
        available = false;
    }
    return available;
}

export const safeStorage = {
    get(key) {
        try {
            if (detect()) return window.localStorage.getItem(key);
        } catch { /* fall through */ }
        return memory.has(key) ? memory.get(key) : null;
    },

    set(key, value) {
        try {
            if (detect()) {
                window.localStorage.setItem(key, value);
                return;
            }
        } catch { /* fall through */ }
        memory.set(key, value);
    },

    remove(key) {
        try {
            if (detect()) {
                window.localStorage.removeItem(key);
                return;
            }
        } catch { /* fall through */ }
        memory.delete(key);
    },
};
