// notes-page.js — notes page entry: renders public notes, owner editing.

import { CONFIG, checkConfig } from "./config.js";
import { initPalette } from "./commands.js";
import { renderMarkdown } from "./markdown.js";
import { escapeHtml, showToast } from "./ui.js";
import {
    apiConfigured, loginUrl, whoAmI, logout,
    fetchPublicNotes, fetchAllNotes,
    createNote, updateNote, deleteNote,
    saveLocalDraft, loadLocalDraft, clearLocalDraft,
} from "./notes.js";

const configured = (v) => v && !v.startsWith("YOUR_");
const user = (CONFIG.username || "").toLowerCase() || "mythicalpengu";

let isOwner = false;
let showingDrafts = false;
let allNotesCache = [];
let editingId = null;       // null = new note
let editingStatus = null;   // "draft" | "published"
let dirty = false;
let pendingDeleteId = null;

const els = {
    list: document.getElementById("notes-list"),
    actions: document.getElementById("owner-actions"),
    btnNew: document.getElementById("btn-new-note"),
    btnDrafts: document.getElementById("btn-show-drafts"),
    btnLogout: document.getElementById("btn-logout"),
    editor: document.getElementById("editor"),
    editorTitle: document.getElementById("editor-title"),
    form: document.getElementById("editor-form"),
    fTitle: document.getElementById("note-title"),
    fDate: document.getElementById("note-date"),
    fTags: document.getElementById("note-tags"),
    fBody: document.getElementById("note-body"),
    status: document.getElementById("editor-status"),
    btnSave: document.getElementById("btn-save-note"),
    btnPublish: document.getElementById("btn-publish-note"),
    btnDelete: document.getElementById("btn-delete-note"),
    confirm: document.getElementById("confirm"),
    confirmDetail: document.getElementById("confirm-detail"),
    confirmCancel: document.getElementById("confirm-cancel"),
    confirmDelete: document.getElementById("confirm-delete"),
    ownerLink: document.getElementById("owner-link"),
    footerUser: document.getElementById("footer-user"),
    footerYear: document.getElementById("footer-year"),
};

init();

async function init() {
    if (els.footerUser) els.footerUser.textContent = user;
    if (els.footerYear) els.footerYear.textContent = new Date().getFullYear();

    const pathUser = document.querySelector(".topbar__user");
    if (pathUser) pathUser.textContent = `/${user}`;

    initPalette();

    if (!configured(CONFIG.notesApi) || !apiConfigured()) {
        if (els.ownerLink) els.ownerLink.hidden = true;
        renderFallback();
        return;
    }

    // render the public list first; owner state upgrades the page when it arrives
    loadNotes();
    const me = await whoAmI();
    if (me && me.owner) {
        isOwner = true;
        if (els.actions) els.actions.hidden = false;
        if (els.ownerLink) els.ownerLink.hidden = true;
        loadNotes();
    } else if (els.ownerLink) {
        els.ownerLink.hidden = false;
        els.ownerLink.href = loginUrl();
    }

    bindOwnerControls();
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
async function loadNotes() {
    try {
        const notes = isOwner ? await fetchAllNotes() : await fetchPublicNotes();
        allNotesCache = notes;
        renderNotes(notes);
    } catch {
        renderApiError();
    }
}

function renderNotes(notes) {
    if (!els.list) return;
    els.list.innerHTML = "";

    const list = isOwner
        ? notes.filter((n) => (showingDrafts ? n.status === "draft" : n.status === "published"))
        : notes.filter((n) => n.status === "published");

    if (list.length === 0) {
        const empty = document.createElement("p");
        empty.className = "notes__empty";
        empty.textContent = showingDrafts ? "no drafts." : "nothing here yet.";
        els.list.appendChild(empty);
        return;
    }

    const sorted = [...list].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    sorted.forEach((note) => els.list.appendChild(noteCard(note)));
}

function noteCard(note) {
    const card = document.createElement("article");
    card.className = "note-card" + (note.status === "draft" ? " note-card--draft" : "");

    const meta = document.createElement("div");
    meta.className = "note-card__meta";

    const date = document.createElement("span");
    date.className = "note-card__date";
    date.textContent = `[ ${note.date || "undated"} ]`;
    meta.appendChild(date);

    if (note.updated && note.updated !== note.date) {
        const updated = document.createElement("span");
        updated.textContent = `updated ${note.updated}`;
        meta.appendChild(updated);
    }

    (note.tags || []).forEach((tag) => {
        const t = document.createElement("span");
        t.className = "note-card__tag";
        t.textContent = tag;
        meta.appendChild(t);
    });

    if (note.status === "draft") {
        const s = document.createElement("span");
        s.className = "note-card__status";
        s.textContent = "draft";
        meta.appendChild(s);
    }

    const title = document.createElement("h2");
    title.className = "note-card__title";
    title.textContent = note.title || "untitled";

    const body = document.createElement("div");
    body.className = "note-card__body";
    body.innerHTML = renderMarkdown(note.body || "");

    card.appendChild(meta);
    card.appendChild(title);
    card.appendChild(body);

    if (isOwner) {
        const actions = document.createElement("div");
        actions.className = "note-card__actions";

        actions.appendChild(actionBtn("edit", () => openEditor(note)));
        actions.appendChild(actionBtn(
            note.status === "published" ? "unpublish" : "publish",
            () => togglePublish(note)
        ));
        actions.appendChild(actionBtn("delete", () => askDelete(note), "btn--danger"));

        card.appendChild(actions);
    }

    return card;
}

function actionBtn(label, onClick, extraClass = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn--ghost ${extraClass}`.trim();
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
}

function renderFallback() {
    if (!els.list) return;
    els.list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "notes__empty";
    p.textContent = "the notes service is sleeping.";
    els.list.appendChild(p);
}

function renderApiError() {
    if (!els.list) return;
    els.list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "notes__empty";
    p.textContent = "couldn't reach the notes service.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn--ghost";
    retry.textContent = "retry";
    retry.style.marginTop = "10px";
    retry.addEventListener("click", () => {
        els.list.innerHTML = '<p class="notes__loading">reading /notes<span class="cursor">_</span></p>';
        loadNotes();
    });
    els.list.appendChild(p);
    els.list.appendChild(retry);
}

// ---------------------------------------------------------------------------
// owner controls
// ---------------------------------------------------------------------------
function bindOwnerControls() {
    if (!isOwner) return;

    if (els.btnNew) els.btnNew.addEventListener("click", () => openEditor(null));
    if (els.btnDrafts) els.btnDrafts.addEventListener("click", () => {
        showingDrafts = !showingDrafts;
        els.btnDrafts.textContent = showingDrafts ? "published" : "drafts";
        renderNotes(allNotesCache);
    });
    if (els.btnLogout) els.btnLogout.addEventListener("click", async () => {
        await logout();
        window.location.reload();
    });

    // editor
    if (els.editor) {
        els.editor.addEventListener("click", (e) => {
            if (e.target.closest("[data-editor-close]")) attemptCloseEditor();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !els.editor.hidden) attemptCloseEditor();
        });
    }

    if (els.form) {
        els.form.addEventListener("input", () => { dirty = true; });
        els.form.addEventListener("submit", (e) => { e.preventDefault(); saveNote("draft"); });
    }
    if (els.btnSave) els.btnSave.addEventListener("click", (e) => { e.preventDefault(); saveNote("draft"); });
    if (els.btnPublish) els.btnPublish.addEventListener("click", (e) => { e.preventDefault(); saveNote("published"); });
    if (els.btnDelete) els.btnDelete.addEventListener("click", () => {
        pendingDeleteId = editingId;
        if (els.confirmDetail) {
            els.confirmDetail.textContent = els.fTitle.value || "untitled";
        }
        if (els.confirm) els.confirm.hidden = false;
    });

    // confirm dialog
    if (els.confirmCancel) els.confirmCancel.addEventListener("click", () => {
        if (els.confirm) els.confirm.hidden = true;
        pendingDeleteId = null;
    });
    if (els.confirmDelete) els.confirmDelete.addEventListener("click", async () => {
        if (!pendingDeleteId) return;
        els.confirmDelete.disabled = true;
        try {
            await deleteNote(pendingDeleteId);
            if (els.confirm) els.confirm.hidden = true;
            closeEditor();
            showToast("deleted");
            loadNotes();
        } catch (err) {
            showToast(err.message || "couldn't delete");
        } finally {
            els.confirmDelete.disabled = false;
            pendingDeleteId = null;
        }
    });

    // warn before losing unsaved edits
    window.addEventListener("beforeunload", (e) => {
        if (dirty && els.editor && !els.editor.hidden) {
            e.preventDefault();
            e.returnValue = "";
        }
    });

    // restore a local draft if the editor was closed accidentally
    const local = loadLocalDraft();
    if (local && local.body) {
        openEditor(null);
        els.fTitle.value = local.title || "";
        els.fBody.value = local.body || "";
        setStatus("recovered unsaved draft from last time", "ok");
        dirty = true;
    }
}

function openEditor(note) {
    editingId = note ? note.id : null;
    editingStatus = note ? note.status : "draft";
    dirty = false;

    if (els.editorTitle) els.editorTitle.textContent = note ? "// edit note" : "// new note";
    if (els.fTitle) els.fTitle.value = note ? note.title || "" : "";
    if (els.fDate) els.fDate.value = note ? note.date || today() : today();
    if (els.fTags) els.fTags.value = note && note.tags ? note.tags.join(", ") : "";
    if (els.fBody) els.fBody.value = note ? note.body || "" : "";
    if (els.btnDelete) els.btnDelete.hidden = !note;
    if (els.btnPublish) els.btnPublish.textContent = note && note.status === "published" ? "update" : "publish";
    setStatus("");

    if (els.editor) els.editor.hidden = false;
    if (els.fTitle) els.fTitle.focus();
}

function closeEditor() {
    if (!els.editor) return;
    els.editor.hidden = true;
    editingId = null;
    dirty = false;
    clearLocalDraft();
}

function attemptCloseEditor() {
    if (dirty) {
        saveLocalDraft({
            title: els.fTitle ? els.fTitle.value : "",
            body: els.fBody ? els.fBody.value : "",
        });
    }
    closeEditor();
}

async function saveNote(status) {
    const title = els.fTitle.value.trim();
    const body = els.fBody.value;

    if (!title) { setStatus("a title is needed", "error"); return; }
    if (body.length > 20000) { setStatus("note is too long (20k max)", "error"); return; }

    const fields = {
        title,
        body,
        date: els.fDate.value || today(),
        tags: els.fTags.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5),
        status,
    };

    setBusy(true);
    try {
        if (editingId) {
            await updateNote(editingId, fields);
        } else {
            const created = await createNote(fields);
            editingId = created.note ? created.note.id : null;
        }
        dirty = false;
        clearLocalDraft();
        editingStatus = status;
        setStatus(status === "published" ? "published" : "saved", "ok");
        showToast(status === "published" ? "published" : "saved");
        closeEditor();
        loadNotes();
    } catch (err) {
        if (err.status === 401) {
            setStatus("session expired — log in again", "error");
        } else {
            setStatus(err.message || "couldn't save", "error");
        }
    } finally {
        setBusy(false);
    }
}

async function togglePublish(note) {
    const target = note.status === "published" ? "draft" : "published";
    try {
        await updateNote(note.id, { status: target });
        showToast(target === "published" ? "published" : "unpublished");
        loadNotes();
    } catch (err) {
        showToast(err.message || "couldn't update");
    }
}

function askDelete(note) {
    pendingDeleteId = note.id;
    if (els.confirmDetail) els.confirmDetail.textContent = note.title || "untitled";
    if (els.confirm) els.confirm.hidden = false;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function today() {
    return new Date().toISOString().slice(0, 10);
}

function setStatus(message, kind = "") {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.className = `editor__status ${kind ? `is-${kind}` : ""}`.trim();
}

function setBusy(busy) {
    if (els.btnSave) els.btnSave.disabled = busy;
    if (els.btnPublish) els.btnPublish.disabled = busy;
}
