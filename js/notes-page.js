// notes-page.js — notes page entry: public list, owner login, owner editing.

import { initChrome } from "./common.js";
import { renderMarkdown } from "./markdown.js";
import { showToast, openDialog, closeDialog, isDialogOpen } from "./ui.js";
import {
    apiConfigured, login, logout, whoAmI, changePassword,
    fetchPublicNotes, fetchAllNotes,
    createNote, updateNote, deleteNote,
    saveLocalDraft, loadLocalDraft, clearLocalDraft,
} from "./notes.js";

let isOwner = false;
let showingDrafts = false;
let allNotesCache = [];
let editingId = null;       // null = new note
let editingStatus = "draft"; // status the note being edited already has
let dirty = false;
let pendingDeleteId = null;
let loadToken = 0;          // ignores out-of-order responses

const $ = (id) => document.getElementById(id);

const els = {
    list: $("notes-list"),
    actions: $("owner-actions"),
    btnNew: $("btn-new-note"),
    btnDrafts: $("btn-show-drafts"),
    btnLogout: $("btn-logout"),
    btnPassword: $("btn-password"),
    ownerLink: $("owner-link"),

    editor: $("editor"),
    editorTitle: $("editor-title"),
    form: $("editor-form"),
    fTitle: $("note-title"),
    fDate: $("note-date"),
    fTags: $("note-tags"),
    fBody: $("note-body"),
    status: $("editor-status"),
    btnSave: $("btn-save-note"),
    btnPublish: $("btn-publish-note"),
    btnDelete: $("btn-delete-note"),

    confirm: $("confirm"),
    confirmDetail: $("confirm-detail"),
    confirmCancel: $("confirm-cancel"),
    confirmDelete: $("confirm-delete"),

    login: $("login"),
    loginForm: $("login-form"),
    loginPass: $("login-pass"),
    loginStatus: $("login-status"),
    loginSubmit: $("login-submit"),
    loginCancel: $("login-cancel"),

    password: $("password"),
    pwForm: $("password-form"),
    pwCurrent: $("pw-current"),
    pwNew: $("pw-new"),
    pwRepeat: $("pw-repeat"),
    pwStatus: $("password-status"),
    pwSubmit: $("pw-submit"),
    pwCancel: $("pw-cancel"),
};

init();

async function init() {
    initChrome();
    bindControls();

    if (!apiConfigured()) {
        if (els.ownerLink) els.ownerLink.hidden = true;
        renderMessage("the notes service is sleeping.");
        return;
    }

    // public list first; owner mode upgrades the page when the token checks out
    loadNotes();
    const me = await whoAmI();
    setOwner(!!me.owner, { reload: !!me.owner });

    if (!isOwner && window.location.hash === "#login") openLogin();
}

// ---------------------------------------------------------------------------
// owner state
// ---------------------------------------------------------------------------
function setOwner(value, { reload = true } = {}) {
    isOwner = value;
    if (els.actions) els.actions.hidden = !value;
    if (els.ownerLink) els.ownerLink.hidden = value;
    if (!value) {
        showingDrafts = false;
        if (els.btnDrafts) els.btnDrafts.textContent = "drafts";
    }
    if (reload) loadNotes();
}

function handleError(err, fallback) {
    if (err && err.status === 401) {
        setOwner(false);
        if (isDialogOpen(els.editor)) {
            // a new note that was being written stays on this device instead of vanishing
            if (!editingId && (els.fTitle.value.trim() || els.fBody.value.trim())) {
                saveLocalDraft({ title: els.fTitle.value, body: els.fBody.value, date: els.fDate.value, tags: els.fTags.value });
            }
            closeEditor({ keepLocalDraft: true });
        }
        if (isDialogOpen(els.password)) closePassword();
        showToast("session expired");
        openLogin("session expired — log in again");
        return;
    }
    showToast((err && err.message) || fallback);
}

// ---------------------------------------------------------------------------
// login dialog
// ---------------------------------------------------------------------------
function openLogin(message = "") {
    if (!els.login) return;
    setLoginStatus(message, message ? "error" : "");
    els.loginPass.value = "";
    openDialog(els.login, els.loginPass);
}

function closeLogin() {
    closeDialog(els.login);
    if (window.location.hash === "#login") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
    }
}

function setLoginStatus(message, kind = "") {
    if (!els.loginStatus) return;
    els.loginStatus.textContent = message;
    els.loginStatus.className = `editor__status ${kind ? `is-${kind}` : ""}`.trim();
}

async function submitLogin(e) {
    e.preventDefault();
    const password = els.loginPass.value;
    if (!password) { setLoginStatus("enter the password", "error"); return; }

    els.loginSubmit.disabled = true;
    setLoginStatus("checking...");
    try {
        await login(password);
        closeLogin();
        setOwner(true);
        showToast("logged in");
    } catch (err) {
        els.loginPass.value = "";
        els.loginPass.focus();
        const messages = {
            401: "wrong password",
            429: "too many tries — wait a bit and try again",
            503: "owner login isn't set up on the server yet",
        };
        setLoginStatus(messages[err.status] || err.message || "couldn't log in", "error");
    } finally {
        els.loginSubmit.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// change password dialog
// ---------------------------------------------------------------------------
function openPassword() {
    if (!isOwner || !els.password) return;
    els.pwForm.reset();
    setPasswordStatus("");
    openDialog(els.password, els.pwCurrent);
}

function closePassword() {
    closeDialog(els.password);
    els.pwForm.reset();           // never leave typed passwords sitting in the fields
}

function setPasswordStatus(message, kind = "") {
    if (!els.pwStatus) return;
    els.pwStatus.textContent = message;
    els.pwStatus.className = `editor__status ${kind ? `is-${kind}` : ""}`.trim();
}

async function submitPassword(e) {
    e.preventDefault();
    const current = els.pwCurrent.value;
    const next = els.pwNew.value;
    const repeat = els.pwRepeat.value;

    if (!current) { setPasswordStatus("enter your current password", "error"); els.pwCurrent.focus(); return; }
    if (next.length < 10) { setPasswordStatus("new password needs at least 10 characters", "error"); els.pwNew.focus(); return; }
    if (next !== repeat) { setPasswordStatus("the two new passwords don't match", "error"); els.pwRepeat.focus(); return; }
    if (next === current) { setPasswordStatus("new password must be different", "error"); els.pwNew.focus(); return; }

    els.pwSubmit.disabled = true;
    setPasswordStatus("updating...");
    try {
        await changePassword(current, next);
        closePassword();
        showToast("password updated · other devices were logged out", 3200);
    } catch (err) {
        if (err.status === 401) { handleError(err); return; }
        const messages = {
            403: "current password is wrong",
            429: "too many wrong tries — wait a bit",
        };
        setPasswordStatus(messages[err.status] || err.message || "couldn't update the password", "error");
        els.pwCurrent.value = "";
        els.pwCurrent.focus();
    } finally {
        els.pwSubmit.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
async function loadNotes() {
    const mine = ++loadToken;
    try {
        const notes = isOwner ? await fetchAllNotes() : await fetchPublicNotes();
        if (mine !== loadToken) return;          // a newer load has started
        allNotesCache = notes;
        renderNotes(notes);
    } catch (err) {
        if (mine !== loadToken) return;
        if (err.status === 401) { handleError(err); return; }
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
        renderMessage(showingDrafts ? "no drafts." : "nothing here yet.");
        return;
    }

    const newestFirst = (a, b) =>
        (b.date || "").localeCompare(a.date || "") ||
        (b.updated || "").localeCompare(a.updated || "");

    [...list].sort(newestFirst).forEach((note) => els.list.appendChild(noteCard(note)));
}

function renderMessage(text) {
    if (!els.list) return;
    els.list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "notes__empty";
    p.textContent = text;
    els.list.appendChild(p);
}

function renderApiError() {
    if (!els.list) return;
    renderMessage("couldn't reach the notes service.");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn--ghost notes__retry";
    retry.textContent = "retry";
    retry.addEventListener("click", () => {
        els.list.innerHTML = '<p class="notes__loading"><span class="notes__loading-text">reading /notes</span><span class="cursor" aria-hidden="true">_</span></p>';
        loadNotes();
    });
    els.list.appendChild(retry);
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
    body.innerHTML = renderMarkdown(note.body || "");   // escaped first, see markdown.js

    card.append(meta, title, body);

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

// ---------------------------------------------------------------------------
// controls (bound once; every handler checks isOwner)
// ---------------------------------------------------------------------------
function bindControls() {
    if (els.ownerLink) els.ownerLink.addEventListener("click", (e) => {
        e.preventDefault();
        openLogin();
    });

    if (els.loginForm) els.loginForm.addEventListener("submit", submitLogin);
    if (els.loginCancel) els.loginCancel.addEventListener("click", closeLogin);
    if (els.login) els.login.addEventListener("click", (e) => {
        if (e.target.closest("[data-login-close]")) closeLogin();
    });

    if (els.btnPassword) els.btnPassword.addEventListener("click", () => openPassword());
    if (els.pwForm) els.pwForm.addEventListener("submit", submitPassword);
    if (els.pwCancel) els.pwCancel.addEventListener("click", closePassword);
    if (els.password) els.password.addEventListener("click", (e) => {
        if (e.target.closest("[data-password-close]")) closePassword();
    });

    if (els.btnNew) els.btnNew.addEventListener("click", () => openEditor(null));
    if (els.btnDrafts) els.btnDrafts.addEventListener("click", () => {
        showingDrafts = !showingDrafts;
        els.btnDrafts.textContent = showingDrafts ? "published" : "drafts";
        renderNotes(allNotesCache);
    });
    if (els.btnLogout) els.btnLogout.addEventListener("click", () => {
        logout();
        setOwner(false);
        showToast("logged out");
    });

    if (els.editor) els.editor.addEventListener("click", (e) => {
        if (e.target.closest("[data-editor-close]")) attemptCloseEditor();
    });

    if (els.form) {
        els.form.addEventListener("input", () => { dirty = true; });
        els.form.addEventListener("submit", (e) => { e.preventDefault(); saveNote(editingStatus === "published" ? "published" : "draft"); });
    }
    if (els.btnPublish) els.btnPublish.addEventListener("click", (e) => { e.preventDefault(); saveNote("published"); });
    if (els.btnDelete) els.btnDelete.addEventListener("click", () => {
        if (editingId) askDelete({ id: editingId, title: els.fTitle.value });
    });

    if (els.confirmCancel) els.confirmCancel.addEventListener("click", closeConfirm);
    if (els.confirm) els.confirm.addEventListener("click", (e) => {
        if (e.target.classList.contains("confirm__backdrop")) closeConfirm();
    });
    if (els.confirmDelete) els.confirmDelete.addEventListener("click", confirmDelete);

    // escape closes whatever is on top: confirm → login → editor
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (isDialogOpen(els.confirm)) closeConfirm();
        else if (isDialogOpen(els.password)) closePassword();
        else if (isDialogOpen(els.login)) closeLogin();
        else if (isDialogOpen(els.editor)) attemptCloseEditor();
    });

    // ctrl+k → "owner login" while already on this page only changes the hash
    window.addEventListener("hashchange", () => {
        if (window.location.hash === "#login" && !isOwner && !isDialogOpen(els.login)) openLogin();
    });

    // warn before losing unsaved edits
    window.addEventListener("beforeunload", (e) => {
        if (dirty && isDialogOpen(els.editor)) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
}

// ---------------------------------------------------------------------------
// editor
// ---------------------------------------------------------------------------
function openEditor(note) {
    if (!isOwner) return;
    editingId = note ? note.id : null;
    editingStatus = note ? note.status : "draft";
    dirty = false;

    els.editorTitle.textContent = note ? "// edit note" : "// new note";
    els.fTitle.value = note ? note.title || "" : "";
    els.fDate.value = note ? note.date || today() : today();
    els.fTags.value = note && note.tags ? note.tags.join(", ") : "";
    els.fBody.value = note ? note.body || "" : "";
    els.btnDelete.hidden = !note;
    els.btnPublish.textContent = note && note.status === "published" ? "update" : "publish";
    els.btnSave.hidden = editingStatus === "published";
    setStatus("");

    // a new note picks up whatever was left unsaved last time
    if (!note) {
        const local = loadLocalDraft();
        if (local && (local.title || local.body)) {
            els.fTitle.value = local.title || "";
            els.fDate.value = local.date || today();
            els.fTags.value = local.tags || "";
            els.fBody.value = local.body || "";
            setStatus("recovered the draft you didn't save last time", "ok");
            dirty = true;
        }
    }

    openDialog(els.editor, els.fTitle);
}

function closeEditor({ keepLocalDraft = false } = {}) {
    closeDialog(els.editor);
    // only a new note owns the on-device draft; closing an edit of an existing note must not touch it
    if (!keepLocalDraft && !editingId) clearLocalDraft();
    editingId = null;
    editingStatus = "draft";
    dirty = false;
}

function attemptCloseEditor() {
    if (!dirty) { closeEditor({ keepLocalDraft: true }); return; }

    if (editingId) {
        // editing an existing note: don't silently throw edits away
        if (!window.confirm("discard your unsaved changes?")) return;
        closeEditor();
        return;
    }

    // new note: keep what was typed on this device (or drop it if it's empty)
    const title = els.fTitle.value.trim();
    const body = els.fBody.value;
    if (title || body.trim()) {
        saveLocalDraft({ title: els.fTitle.value, body, date: els.fDate.value, tags: els.fTags.value });
        showToast("draft kept on this device");
        closeEditor({ keepLocalDraft: true });
    } else {
        closeEditor();
    }
}

async function saveNote(status) {
    const title = els.fTitle.value.trim();
    const body = els.fBody.value;

    if (!title) { setStatus("a title is needed", "error"); els.fTitle.focus(); return; }
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
        if (editingId) await updateNote(editingId, fields);
        else await createNote(fields);

        showToast(status === "published" ? "published" : "saved");
        closeEditor();                // also clears the local draft
        loadNotes();
    } catch (err) {
        if (err.status === 401) handleError(err);
        else setStatus(err.message || "couldn't save", "error");
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
        handleError(err, "couldn't update");
    }
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
function askDelete(note) {
    pendingDeleteId = note.id;
    els.confirmDetail.textContent = note.title || "untitled";
    openDialog(els.confirm, els.confirmCancel);      // cancel is the safe default
}

function closeConfirm() {
    closeDialog(els.confirm);
    pendingDeleteId = null;
}

async function confirmDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    els.confirmDelete.disabled = true;
    try {
        await deleteNote(id);
        closeConfirm();
        if (isDialogOpen(els.editor)) closeEditor();
        showToast("deleted");
        loadNotes();
    } catch (err) {
        closeConfirm();
        handleError(err, "couldn't delete");
    } finally {
        els.confirmDelete.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function today() {
    const d = new Date();      // local date, not utc, so late evenings don't land on "tomorrow"/"yesterday"
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
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
