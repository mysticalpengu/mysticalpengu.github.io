// ui.js — small shared helpers: toast, clipboard, dialogs.

export function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

let toastTimer = null;

export function showToast(message, ms = 1800) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// dialogs: remember where focus was, keep tab inside, give focus back on close
// ---------------------------------------------------------------------------
const dialogStack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openDialog(el, focusTarget) {
    if (!el) return;
    if (!dialogStack.some((d) => d.el === el)) {
        dialogStack.push({ el, previous: document.activeElement });
    }
    el.hidden = false;
    syncScrollLock();
    if (focusTarget) focusTarget.focus();
}

export function closeDialog(el) {
    if (!el) return;
    el.hidden = true;
    const index = dialogStack.findIndex((d) => d.el === el);
    if (index === -1) { syncScrollLock(); return; }
    const [{ previous }] = dialogStack.splice(index, 1);
    syncScrollLock();
    if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus();
}

function syncScrollLock() {
    document.body.classList.toggle("has-dialog", dialogStack.length > 0);
}

export function isDialogOpen(el) {
    return !!el && !el.hidden;
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || dialogStack.length === 0) return;

    const top = dialogStack[dialogStack.length - 1].el;
    const items = [...top.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (!top.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});
