// safe-storage.js — web storage that never throws.
// some browsers (private mode, strict settings) deny storage entirely.
// the site must keep working when that happens, so everything falls back to memory.

function makeSafe(kind) {
    const memory = new Map();
    let available = null;

    const store = () => window[kind];

    function detect() {
        if (available !== null) return available;
        try {
            const probe = "__probe__";
            store().setItem(probe, "1");
            store().removeItem(probe);
            available = true;
        } catch {
            available = false;
        }
        return available;
    }

    return {
        get(key) {
            try {
                if (detect()) return store().getItem(key);
            } catch { /* fall through */ }
            return memory.has(key) ? memory.get(key) : null;
        },

        set(key, value) {
            try {
                if (detect()) {
                    store().setItem(key, value);
                    return;
                }
            } catch { /* fall through */ }
            memory.set(key, value);
        },

        remove(key) {
            try {
                if (detect()) {
                    store().removeItem(key);
                    return;
                }
            } catch { /* fall through */ }
            memory.delete(key);
        },
    };
}

// survives closing the tab (login token, editor draft)
export const safeStorage = makeSafe("localStorage");

// gone when the tab closes (boot animation "seen" flag)
export const safeSession = makeSafe("sessionStorage");
