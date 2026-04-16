/* ─────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────── */
const OVERRIDES_KEY    = "research_projects_overrides_v1";
const APPLICATIONS_KEY = "research_projects_applications_v1";
const PROFILE_KEY      = "research_projects_profile_v1";

const VALID_STATUSES = new Set(["Active", "Planning", "Completed"]);
const VALID_TYPES = new Set(["Research", "QI", "Edu/Res", "Clin Trial"]);
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

const ALLOWED_OVERRIDE_KEYS = new Set([
    "contactName", "contactEmail", "status", "type", "residentSlots", "studentSlots",
    "durationRange", "targetDate", "lastUpdated", "title", "faculty", "trainees",
    "description", "skills", "time"
]);

const ALLOWED_CHECK_CLASSES = new Set(['typeCheck', 'statusCheck']);

const FILTER_LABEL_MAP = { open: 'Open', closed: 'Full', upcoming: 'Upcoming', completed: 'Completed', stale: 'Stale' };

/* ─────────────────────────────────────────────────────────
   Utilities
───────────────────────────────────────────────────────── */
function isValidEmail(str) {
    if (typeof str !== "string" || str.length > MAX_EMAIL_LENGTH) return false;
    const atIdx = str.indexOf("@");
    if (atIdx < 1 || atIdx > 64) return false;
    return EMAIL_RE.test(str);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function namesToLines(str) {
    if (!str || str === '—') return '—';
    return str.split(',').map(n => escapeHtml(n.trim())).filter(Boolean).join('<br>');
}

function statusBadge(s) {
    return ({ Active:"bg-blue-100 text-blue-800", Planning:"bg-amber-100 text-amber-800", Completed:"bg-green-100 text-green-800" })[s] || "bg-gray-100 text-gray-800";
}

function typeBadge(t) {
    return ({ Research:"bg-emerald-100 text-emerald-800", QI:"bg-indigo-100 text-indigo-800", "Edu/Res":"bg-yellow-100 text-yellow-800", "Clin Trial":"bg-pink-100 text-pink-800" })[t] || "bg-gray-100 text-gray-800";
}

function totalOpenings(p) { return (Number(p.residentSlots) || 0) + (Number(p.studentSlots) || 0); }

function parseHoursMin(timeStr) {
    if (!timeStr) return 999;
    const s = timeStr.toLowerCase();
    if (s.includes('flex')) return 999;
    const match = s.match(/(\d+(\.\d+)?)/);
    return match ? Number(match[1]) : 999;
}

function toDateOrNull(iso) {
    if (!iso || typeof iso !== "string") return null;
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
    const d = toDateOrNull(iso);
    if (!d) return "TBD";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysSince(iso) {
    const d = toDateOrNull(iso);
    if (!d) return null;
    const now = new Date();
    return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isStale(p) {
    if (p.status === "Completed") return false;
    const ds = daysSince(p.lastUpdated);
    return ds !== null && ds > 120;
}

function debounce(fn, ms) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/* ─────────────────────────────────────────────────────────
   Storage helpers
───────────────────────────────────────────────────────── */
function safeSave(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* storage full or unavailable */ }
}

function sanitizeOverride(obj) {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!ALLOWED_OVERRIDE_KEYS.has(k)) continue;
        if (k === "status" && !VALID_STATUSES.has(v)) continue;
        if (k === "type" && !VALID_TYPES.has(v)) continue;
        if (k === "contactEmail" && v !== "" && !isValidEmail(v)) continue;
        if (k === "residentSlots" || k === "studentSlots") {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) continue;
            clean[k] = n;
            continue;
        }
        if (typeof v === "string") {
            clean[k] = v.slice(0, 1000);
        }
    }
    return clean;
}

/* Overrides (admin edits) */
function loadOverrides() {
    try {
        const raw = localStorage.getItem(OVERRIDES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const sanitized = {};
        for (const [id, override] of Object.entries(parsed)) {
            if (!/^\d+$/.test(String(id))) continue;
            sanitized[id] = sanitizeOverride(override);
        }
        return sanitized;
    } catch {
        return {};
    }
}

function saveOverrides(overrides) {
    safeSave(OVERRIDES_KEY, overrides);
}

function applyOverrides(base, overrides) {
    return base.map(p => ({ ...p, ...(overrides[p.id] || {}) }));
}

function updateProject(id, patch, projectDataRef) {
    const cleanPatch = sanitizeOverride(patch);
    const overrides = loadOverrides();
    overrides[id] = { ...(overrides[id] || {}), ...cleanPatch };
    saveOverrides(overrides);

    // mutate in-memory
    for (let i = 0; i < projectDataRef.length; i++) {
        if (projectDataRef[i].id === id) {
            projectDataRef[i] = { ...projectDataRef[i], ...cleanPatch };
            break;
        }
    }
}

/* ─────────────────────────────────────────────────────────
   sessionStorage helpers: applications + profile (PII)
   Uses sessionStorage to limit PII exposure to current tab session.
───────────────────────────────────────────────────────── */
function safeSessionSave(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); }
    catch { /* storage full or unavailable */ }
}

function loadApplications() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(APPLICATIONS_KEY));
        if (!parsed || typeof parsed !== 'object') return Object.create(null);
        return Object.assign(Object.create(null), parsed);
    } catch { return Object.create(null); }
}

function saveApplications(apps) {
    safeSessionSave(APPLICATIONS_KEY, apps);
}

function loadProfile() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(PROFILE_KEY));
        if (!parsed || typeof parsed !== 'object') return Object.create(null);
        return Object.assign(Object.create(null), parsed);
    } catch { return Object.create(null); }
}

function saveProfile(profile) {
    safeSessionSave(PROFILE_KEY, profile);
}

function normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
}

function getCurrentApplicantEmail() {
    const profile = loadProfile();
    return normalizeEmail(profile.email || "");
}

function setCurrentApplicantEmail(email) {
    const profile = loadProfile();
    profile.email = normalizeEmail(email);
    saveProfile(profile);
}

function hasApplied(email, projectId) {
    const e = normalizeEmail(email);
    if (!e) return false;
    const apps = loadApplications();
    return Boolean(apps[e]?.[String(projectId)]);
}

function getApplicationMeta(email, projectId) {
    const e = normalizeEmail(email);
    if (!e) return null;
    const apps = loadApplications();
    return apps[e]?.[String(projectId)] || null;
}

function recordApplication(email, projectId, payload) {
    const e = normalizeEmail(email);
    if (!e) return;
    const apps = loadApplications();
    apps[e] = apps[e] || {};
    apps[e][String(projectId)] = {
        submittedAt: new Date().toISOString(),
        ...payload
    };
    saveApplications(apps);
}

/* ─────────────────────────────────────────────────────────
   Scroll lock (prevents background page scroll when modal open)
───────────────────────────────────────────────────────── */
let __scrollLockY = 0;

function lockBodyScroll() {
    __scrollLockY = window.scrollY || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${__scrollLockY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflowY = "scroll";
}

function unlockBodyScroll() {
    const top = document.body.style.top;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflowY = "";
    const y = top ? Math.abs(parseInt(top, 10)) : __scrollLockY;
    window.scrollTo(0, y || 0);
}

/* ─────────────────────────────────────────────────────────
   Mutable state
───────────────────────────────────────────────────────── */
let projectData = [];
let currentProjectId = null;
let _modalTriggerEl = null;
const selectedIds = new Set();
let lastRenderedIds = [];
let emailFilterActive = false;

/* ─────────────────────────────────────────────────────────
   Selection / export bar
───────────────────────────────────────────────────────── */
function toggleSelection(id) {
    if (selectedIds.has(id)) { selectedIds.delete(id); }
    else { selectedIds.add(id); }
    syncExportBar();
    syncCheckboxes();
}

function selectAllVisible() {
    lastRenderedIds.forEach(id => selectedIds.add(id));
    syncExportBar();
    syncCheckboxes();
}

function clearSelection() {
    selectedIds.clear();
    syncExportBar();
    syncCheckboxes();
}

function syncExportBar() {
    const bar = document.getElementById('exportBar');
    if (!bar) return;
    const count = document.getElementById('selectedCount');
    if (selectedIds.size > 0) {
        bar.classList.remove('collapsed');
        count.textContent = selectedIds.size + ' project' + (selectedIds.size === 1 ? '' : 's') + ' selected';
    } else {
        bar.classList.add('collapsed');
    }
}

function syncCheckboxes() {
    document.querySelectorAll('.select-checkbox').forEach(cb => {
        cb.checked = selectedIds.has(Number(cb.dataset.id));
    });
    const headerCb = document.getElementById('selectAllDesktop');
    if (!headerCb) return;
    if (lastRenderedIds.length === 0) {
        headerCb.checked = false;
        headerCb.indeterminate = false;
    } else {
        const visibleSelected = lastRenderedIds.filter(id => selectedIds.has(id)).length;
        headerCb.checked = visibleSelected === lastRenderedIds.length;
        headerCb.indeterminate = visibleSelected > 0 && visibleSelected < lastRenderedIds.length;
    }
}

/* ─────────────────────────────────────────────────────────
   DOM refs (resolved at parse time — scripts at end of body)
───────────────────────────────────────────────────────── */
const tableBodyDesktop   = document.getElementById("table-body-desktop");
const cardContainer      = document.getElementById("card-container");
const noDesktop          = document.getElementById("no-results-desktop");
const noMobile           = document.getElementById("no-results-mobile");
const searchInput        = document.getElementById("searchInput");
const myEmailInput       = document.getElementById("myEmail");
const emailSearchBtn     = document.getElementById("emailSearchBtn");

const modal              = document.getElementById("signupModal");
const modalTitle         = document.getElementById("modalProjectTitle");
const hiddenTitle        = document.getElementById("projectTitleInput");

const signupForm         = document.getElementById("signupForm");
const confirmationView   = document.getElementById("confirmationView");
const confirmProjectName = document.getElementById("confirmProjectName");
const detailsView        = document.getElementById("projectDetailsView");

const sortSelect         = document.getElementById("sortSelect");

const routeToName        = document.getElementById("routeToName");
const routeToEmailWrap   = document.getElementById("routeToEmailWrap");
const routeToEmail       = document.getElementById("routeToEmail");
const staleBadgeDetail   = document.getElementById("staleBadgeDetail");
const appliedBadgeDetail = document.getElementById("appliedBadgeDetail");
const appliedInfoDetail  = document.getElementById("appliedInfoDetail");

const badgeType          = document.getElementById("badgeType");
const badgeStatus        = document.getElementById("badgeStatus");
const badgeTime          = document.getElementById("badgeTime");
const badgeSlots         = document.getElementById("badgeSlots");

const detailsDescription = document.getElementById("detailsDescription");
const detailsFaculty     = document.getElementById("detailsFaculty");
const detailsTrainees    = document.getElementById("detailsTrainees");
const detailsSkills      = document.getElementById("detailsSkills");

const detailsDuration    = document.getElementById("detailsDuration");
const detailsTargetDate  = document.getElementById("detailsTargetDate");
const detailsLastUpdated = document.getElementById("detailsLastUpdated");
const detailsStaleNote   = document.getElementById("detailsStaleNote");

const detailsContactName = document.getElementById("detailsContactName");
const detailsContactEmailWrap = document.getElementById("detailsContactEmailWrap");
const detailsContactEmail = document.getElementById("detailsContactEmail");

const backToDetailsBtn   = document.getElementById("backToDetails");
const formProjectId      = document.getElementById("formProjectId");

/* Admin inputs */
const adminContactName   = document.getElementById("adminContactName");
const adminContactEmail  = document.getElementById("adminContactEmail");
const adminDurationRange = document.getElementById("adminDurationRange");
const adminTargetDate    = document.getElementById("adminTargetDate");
const adminLastUpdated   = document.getElementById("adminLastUpdated");
const adminStatus        = document.getElementById("adminStatus");
const adminTime          = document.getElementById("adminTime");
const adminStudentSlots  = document.getElementById("adminStudentSlots");
const adminResidentSlots = document.getElementById("adminResidentSlots");

/* ─────────────────────────────────────────────────────────
   Dropdown (ACCESSIBILITY FIX: aria-expanded management)
───────────────────────────────────────────────────────── */
function toggleDropdown(id) {
    const panel = document.getElementById(id);
    const trigger = document.querySelector(`[aria-controls="${id}"]`);
    
    // Close other dropdowns and update their aria-expanded
    document.querySelectorAll('.dropdown-panel').forEach(p => {
        if (p.id !== id) {
            p.classList.remove('open');
            const otherTrigger = document.querySelector(`[aria-controls="${p.id}"]`);
            if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
        }
    });
    
    // Toggle current dropdown and update aria-expanded
    const isOpen = panel.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', isOpen);
}

function setAll(cls, val) {
    if (!ALLOWED_CHECK_CLASSES.has(cls)) return;
    document.querySelectorAll(`.${cls}`).forEach(cb => cb.checked = val);
    filterAndRender();
}

/* ─────────────────────────────────────────────────────────
   CSV export
───────────────────────────────────────────────────────── */
function csvEscape(value) {
    if (value == null) return '';
    let str = String(value);
    // Prevent CSV formula injection in spreadsheet applications
    if (/^[=+\-@\t\r|]/.test(str)) {
        str = "'" + str;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes("'")) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function generateCsv(projects) {
    const headers = [
        'id','title','faculty','trainees','type','description','skills','time',
        'status','durationRange','targetDate','lastUpdated','staleOver120Days',
        'studentSlots','residentSlots','totalOpenings','contactName','contactEmail'
    ];
    const rows = projects.map(p => [
        p.id, p.title, p.faculty, p.trainees, p.type, p.description, p.skills, p.time,
        p.status, p.durationRange, p.targetDate, p.lastUpdated, isStale(p) ? 'Yes' : 'No',
        Number(p.studentSlots) || 0, Number(p.residentSlots) || 0, totalOpenings(p),
        p.contactName || '', p.contactEmail || ''
    ]);
    return headers.join(',') + '\n' + rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function downloadCsv(content, filename) {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function csvFilename() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `anes-research-opportunities_${yyyy}-${mm}-${dd}.csv`;
}

function downloadSelectedCsv() {
    const selected = projectData.filter(p => selectedIds.has(p.id));
    if (!selected.length) return;
    downloadCsv(generateCsv(selected), csvFilename());
}

function downloadAllCsv() {
    if (!projectData.length) return;
    downloadCsv(generateCsv(projectData), csvFilename());
}

/* ─────────────────────────────────────────────────────────
   Views
───────────────────────────────────────────────────────── */
function showDetailsView(id) {
    const p = projectData.find(x => x.id === id);
    if (!p) return;

    currentProjectId = id;
    modalTitle.textContent = p.title;
    hiddenTitle.value = p.title;

    // routing
    routeToName.textContent = p.contactName?.trim() ? p.contactName : "Not listed";
    if (p.contactEmail?.trim() && isValidEmail(p.contactEmail.trim())) {
        routeToEmailWrap.classList.remove("hidden");
        routeToEmail.textContent = p.contactEmail;
        routeToEmail.href = `mailto:${encodeURIComponent(p.contactEmail.trim())}`;
    } else {
        routeToEmailWrap.classList.add("hidden");
        routeToEmail.textContent = "";
        routeToEmail.href = "#";
    }

    const stale = isStale(p);
    staleBadgeDetail.classList.toggle("hidden", !stale);

    const currentEmail = getCurrentApplicantEmail();
    const applied = hasApplied(currentEmail, p.id);
    appliedBadgeDetail.classList.toggle("hidden", !applied);

    if (applied) {
        const meta = getApplicationMeta(currentEmail, p.id);
        const when = meta?.submittedAt ? new Date(meta.submittedAt).toLocaleString() : null;
        appliedInfoDetail.textContent = when ? `Applied on ${when} (for ${currentEmail}).` : `Applied (for ${currentEmail}).`;
        appliedInfoDetail.classList.remove("hidden");
    } else {
        appliedInfoDetail.textContent = "";
        appliedInfoDetail.classList.add("hidden");
    }

    badgeType.textContent = p.type;
    badgeType.className = `px-2 py-0.5 text-xs font-semibold rounded-full ${typeBadge(p.type)}`;

    badgeStatus.textContent = p.status;
    badgeStatus.className = `px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadge(p.status)}`;

    badgeTime.textContent = p.time || "Time: TBD";
    badgeSlots.textContent = `MS: ${Number(p.studentSlots)||0} open • Resident: ${Number(p.residentSlots)||0} open`;

    detailsDescription.textContent = p.description || "";
    detailsFaculty.textContent = p.faculty || "—";
    detailsTrainees.textContent = p.trainees || "—";
    detailsSkills.textContent = p.skills || "—";

    detailsDuration.textContent = p.durationRange || "TBD";
    detailsTargetDate.textContent = p.targetDate || "TBD";
    detailsLastUpdated.textContent = p.lastUpdated ? formatDate(p.lastUpdated) : "TBD";
    detailsStaleNote.classList.toggle("hidden", !stale);

    detailsContactName.textContent = p.contactName?.trim() ? p.contactName : "Not listed";
    if (p.contactEmail?.trim() && isValidEmail(p.contactEmail.trim())) {
        detailsContactEmailWrap.classList.remove("hidden");
        detailsContactEmail.textContent = p.contactEmail;
        detailsContactEmail.href = `mailto:${encodeURIComponent(p.contactEmail.trim())}`;
    } else {
        detailsContactEmailWrap.classList.add("hidden");
        detailsContactEmail.textContent = "";
        detailsContactEmail.href = "#";
    }

    // Admin prefill
    adminContactName.value = p.contactName || "";
    adminContactEmail.value = p.contactEmail || "";
    adminDurationRange.value = p.durationRange || "";
    adminTargetDate.value = p.targetDate || "";
    adminLastUpdated.value = p.lastUpdated || "";
    adminStatus.value = p.status || "Active";
    adminTime.value = p.time || "";
    adminStudentSlots.value = Number(p.studentSlots) || 0;
    adminResidentSlots.value = Number(p.residentSlots) || 0;

    // CTA state (Applied supersedes)
    const openings = totalOpenings(p);
    const isOpen = (p.status !== "Completed" && openings > 0);
    const goBtn = document.getElementById("goToInterest");

    if (p.status === "Completed") {
        goBtn.disabled = true;
        goBtn.textContent = "Completed";
        goBtn.className = "px-6 py-2 bg-transparent text-gray-400 font-semibold rounded-lg cursor-default";
    } else if (stale) {
        goBtn.disabled = true;
        goBtn.textContent = "Not Available";
        goBtn.className = "px-6 py-2 bg-transparent text-gray-400 font-semibold rounded-lg cursor-default";
    } else if (applied) {
        goBtn.disabled = true;
        goBtn.textContent = "Applied";
        goBtn.className = "px-6 py-2 bg-gray-300 text-gray-500 font-semibold rounded-lg cursor-not-allowed";
    } else {
        goBtn.textContent = isOpen ? "Apply" : "Full";
        goBtn.disabled = !isOpen;
        goBtn.className = isOpen
            ? "px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-center"
            : "px-6 py-2 bg-gray-300 text-gray-500 font-semibold rounded-lg cursor-not-allowed text-center";
    }

    detailsView.classList.remove("hidden");
    signupForm.classList.add("hidden");
    confirmationView.classList.add("hidden");
}

function showFormView() {
    detailsView.classList.add("hidden");
    signupForm.classList.remove("hidden");
    confirmationView.classList.add("hidden");

    formProjectId.textContent = String(currentProjectId ?? "");

    const currentEmail = getCurrentApplicantEmail();
    signupForm.reset();
    if (currentEmail) {
        const emailField = signupForm.querySelector('[name="email"]');
        if (emailField) emailField.value = currentEmail;
    }
    setTimeout(() => signupForm.querySelector("#fullName")?.focus(), 50);
}

function showConfirmView(title) {
    detailsView.classList.add("hidden");
    signupForm.classList.add("hidden");
    confirmationView.classList.remove("hidden");
    confirmProjectName.textContent = title;
}

/* ─────────────────────────────────────────────────────────
   Open/close modal + scroll lock
───────────────────────────────────────────────────────── */
function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
}

function openModalWithProject(id) {
    _modalTriggerEl = document.activeElement;
    showDetailsView(id);
    modal.classList.remove("hidden");
    lockBodyScroll();
    document.addEventListener("keydown", trapFocus);
    requestAnimationFrame(() => {
        modal.classList.remove("opacity-0");
        modal.querySelector(".modal-content").classList.remove("-translate-y-10");
        const first = modal.querySelector('button:not([disabled]), input:not([disabled]), a[href]');
        if (first) first.focus();
    });
}

function closeModal() {
    document.removeEventListener("keydown", trapFocus);
    unlockBodyScroll();
    modal.classList.add("opacity-0");
    modal.querySelector(".modal-content").classList.add("-translate-y-10");
    setTimeout(() => {
        modal.classList.add("hidden");
        currentProjectId = null;
        if (_modalTriggerEl) {
            _modalTriggerEl.focus();
            _modalTriggerEl = null;
        }
    }, 250);
}

/* ─────────────────────────────────────────────────────────
   Filter + render
───────────────────────────────────────────────────────── */
function getChecked(cls) { return [...document.querySelectorAll(`.${cls}:checked`)].map(c => c.value); }

function updateLabels() {
    const types = getChecked('typeCheck'), statuses = getChecked('statusCheck');
    const at = document.querySelectorAll('.typeCheck').length;
    const as = document.querySelectorAll('.statusCheck').length;
    document.getElementById('typeLabel').textContent   = types.length === 0 ? 'No Types' : types.length === at ? 'All Project Types' : types.join(', ');
    const filterLabels = statuses.map(s => FILTER_LABEL_MAP[s] || s);
    document.getElementById('statusLabel').textContent = statuses.length === 0 ? 'No Filters' : statuses.length === as ? 'Filter' : filterLabels.join(', ');
}

function applySort(data) {
    const mode = sortSelect.value;
    const arr = [...data];
    if (mode === "slots_desc") arr.sort((a,b) => totalOpenings(b) - totalOpenings(a));
    else if (mode === "hours_asc") arr.sort((a,b) => parseHoursMin(a.time) - parseHoursMin(b.time));
    else arr.sort((a,b) => (toDateOrNull(b.lastUpdated)?.getTime() ?? 0) - (toDateOrNull(a.lastUpdated)?.getTime() ?? 0));
    return arr;
}

function filterAndRender() {
    const term = (searchInput.value || "").toLowerCase().trim();
    const types = getChecked('typeCheck'), statuses = getChecked('statusCheck');

    const filtered = projectData.filter(p => {
        if (emailFilterActive) {
            const email = getCurrentApplicantEmail();
            if (email && !hasApplied(email, p.id)) return false;
        }

        const matchesTerm =
            (!term ||
                p.title.toLowerCase().includes(term) ||
                (p.faculty || "").toLowerCase().includes(term) ||
                (p.description || "").toLowerCase().includes(term) ||
                (p.trainees || "").toLowerCase().includes(term) ||
                (p.skills || "").toLowerCase().includes(term)
            );

        const matchesType = (!types.length || types.includes(p.type));

        const stale = isStale(p);
        const openings = totalOpenings(p);
        const isOpenSlots = p.status === "Active" && !stale && openings > 0;
        const isClosedSlots = p.status === "Active" && !stale && openings === 0;

        let matchesStatus = false;
        if (statuses.length === 0) {
            matchesStatus = false;
        } else {
            if (statuses.includes("open") && isOpenSlots) matchesStatus = true;
            if (statuses.includes("closed") && isClosedSlots) matchesStatus = true;
            if (statuses.includes("upcoming") && p.status === "Planning" && !stale) matchesStatus = true;
            if (statuses.includes("completed") && p.status === "Completed") matchesStatus = true;
            if (statuses.includes("stale") && stale) matchesStatus = true;
        }

        return matchesTerm && matchesType && matchesStatus;
    });

    updateLabels();
    renderAll(applySort(filtered));
    
    // ACCESSIBILITY FIX: Announce filter results to screen readers
    const announcement = document.getElementById('results-announcement');
    if (announcement) {
        announcement.textContent = `${filtered.length} project${filtered.length === 1 ? '' : 's'} found`;
    }
}

function renderAll(data) {
    tableBodyDesktop.innerHTML = "";
    cardContainer.innerHTML = "";

    if (!data.length) {
        lastRenderedIds = [];
        const msg = emailFilterActive
            ? "No applications found for this email."
            : "Try adjusting your search or filter criteria.";
        noDesktop.querySelector("p:last-child").textContent = msg;
        noMobile.querySelector("p:last-child").textContent = msg;
        noDesktop.classList.remove("hidden");
        noMobile.classList.remove("hidden");
        syncExportBar();
        syncCheckboxes();
        return;
    }
    noDesktop.classList.add("hidden");
    noMobile.classList.add("hidden");

    lastRenderedIds = data.map(p => p.id);

    const hasExportBar = !!document.getElementById('exportBar');
    const currentEmail = getCurrentApplicantEmail();

    // ACCESSIBILITY FIX: Create list wrapper for mobile cards
    const mobileList = document.createElement("ul");
    mobileList.className = "space-y-3";
    mobileList.style.listStyle = "none";
    mobileList.style.padding = "0";
    mobileList.style.margin = "0";

    data.forEach(p => {
        const openings = totalOpenings(p);
        const isOpen = (p.status !== "Completed" && openings > 0);
        const muted = (p.status === "Completed");
        const stale = isStale(p);
        const applied = hasApplied(currentEmail, p.id);

        const isCompleted = p.status === "Completed";
        const notAvailable = stale;
        const buttonDisabled = applied || !isOpen || isCompleted || notAvailable;
        const buttonLabel = isCompleted ? "Completed" : notAvailable ? "Not Available" : (applied ? "Applied" : (isOpen ? "Apply" : "Full"));
        const buttonClass = isCompleted
            ? "bg-transparent text-gray-400 cursor-default shadow-none"
            : notAvailable
                ? "bg-transparent text-gray-400 cursor-default shadow-none"
                : buttonDisabled
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 text-white";

        // Desktop row
        const row = document.createElement("tr");
        row.className = `row-clickable ${(muted || notAvailable) ? "text-gray-400" : ""}`;
        if (notAvailable) row.style.opacity = "0.7";
        row.tabIndex = 0;
        row.setAttribute('aria-label', 'View details for ' + escapeHtml(p.title));
        row.dataset.projectId = p.id;

        row.innerHTML = `
      ${hasExportBar ? `<td class="px-2 py-3 text-center align-top select-cell">
        <input type="checkbox" class="select-checkbox h-4 w-4 text-blue-600 rounded border-gray-300" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(p.title)}">
      </td>` : ''}
      <td class="px-4 py-3 align-top overflow-hidden">
        <div class="text-sm font-semibold ${muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'} clamp-2 break-words">${escapeHtml(p.title)}</div>
        <div class="flex items-center flex-wrap gap-x-1 gap-y-0.5 mt-0.5">
          <span class="text-xs text-gray-500 whitespace-nowrap">${escapeHtml(p.time) || 'Time: TBD'}</span>
          <span class="inline-flex items-center gap-1">
          ${notAvailable
            ? `<span class="inline-block whitespace-nowrap px-1.5 py-px text-[0.625rem] leading-tight font-semibold rounded-full bg-amber-100 text-amber-800">Reviewing</span>`
            : `<span class="inline-block whitespace-nowrap px-1.5 py-px text-[0.625rem] leading-tight font-semibold rounded-full ${typeBadge(p.type)}">${escapeHtml(p.type)}</span>
               ${applied ? `<span class="inline-block whitespace-nowrap px-1.5 py-px text-[0.625rem] leading-tight font-semibold rounded-full bg-red-100 text-red-800">Applied</span>` : ``}
               <span class="inline-block whitespace-nowrap px-1.5 py-px text-[0.625rem] leading-tight font-semibold rounded-full ${statusBadge(p.status)}">${escapeHtml(p.status)}</span>`}
          </span>
        </div>
        <div class="text-xs text-blue-600 mt-1">View details</div>
      </td>
      <td class="px-4 py-3 align-top overflow-hidden"><div class="text-sm font-medium clamp-4">${namesToLines(p.faculty)}</div></td>
      <td class="px-4 py-3 align-top overflow-hidden"><div class="text-sm clamp-4">${namesToLines(p.trainees)}</div></td>
      <td class="px-4 py-3 align-top overflow-hidden">
        <div class="text-sm text-gray-700 clamp-2 break-words">${escapeHtml(p.description)}</div>
        <div class="text-xs text-gray-500 mt-1 clamp-1">Skills: ${escapeHtml(p.skills)}</div>
      </td>
      <td class="px-4 py-3 text-center align-top overflow-hidden">
        <div class="text-xs font-semibold ${isOpen ? 'text-gray-900' : 'text-gray-500'}"><span class="whitespace-nowrap">MS: ${Number(p.studentSlots)||0}</span> <span class="whitespace-nowrap">R: ${Number(p.residentSlots)||0}</span></div>
        <div class="text-xs text-gray-500 mt-0.5">Total: ${openings}</div>
      </td>
      <td class="px-4 py-3 text-right align-top overflow-hidden">
        <button class="interest-btn w-full whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-lg transition-colors shadow-sm ${buttonClass}"
                data-id="${p.id}" ${buttonDisabled ? "disabled" : ""}>
          ${buttonLabel}
        </button>
      </td>
    `;
        tableBodyDesktop.appendChild(row);

        // ACCESSIBILITY FIX: Mobile card wrapped in <li>
        const li = document.createElement("li");
        const card = document.createElement("div");
        card.className = `bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-4 ${muted ? 'opacity-60' : ''} ${notAvailable ? 'opacity-70' : ''}`;
        card.innerHTML = `
      <div class="flex items-start justify-between gap-3 mb-2">
        ${hasExportBar ? `<input type="checkbox" class="select-checkbox h-4 w-4 mt-1 text-blue-600 rounded border-gray-300 shrink-0" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(p.title)}">` : ''}
        <button class="text-left flex-1 card-title-btn" type="button" data-id="${p.id}">
          <h3 class="text-sm font-semibold ${muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'} leading-snug">${escapeHtml(p.title)}</h3>
          <div class="text-xs text-blue-600 mt-1">View details</div>
        </button>
      </div>

      <div class="flex flex-wrap gap-1.5 mb-3">
        ${notAvailable ? `<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Reviewing</span>` : `
        ${applied ? `<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">Applied</span>` : ``}
        <span class="px-2 py-0.5 text-xs font-semibold rounded-full ${typeBadge(p.type)}">${escapeHtml(p.type)}</span>
        <span class="px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadge(p.status)}">${escapeHtml(p.status)}</span>`}
        <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">${escapeHtml(p.time) || 'Time: TBD'}</span>
        <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">MS: ${Number(p.studentSlots)||0} • R: ${Number(p.residentSlots)||0}</span>
      </div>

      <p class="text-sm text-gray-700 mb-3 clamp-3">${escapeHtml(p.description)}</p>

      <div class="text-xs text-gray-500 space-y-1 mb-4">
        <p><span class="font-medium text-gray-600">Faculty:</span> ${escapeHtml(p.faculty)}</p>
        ${p.trainees !== '—' ? `<p><span class="font-medium text-gray-600">Trainees:</span> ${escapeHtml(p.trainees)}</p>` : ''}
        <p><span class="font-medium text-gray-600">Skills:</span> ${escapeHtml(p.skills)}</p>
        <p><span class="font-medium text-gray-600">Timeline:</span> ${escapeHtml(p.durationRange) || 'TBD'}${(p.targetDate && p.targetDate !== 'TBD') ? ' • ' + escapeHtml(p.targetDate) : ''}</p>
        <p><span class="font-medium text-gray-600">Last updated:</span> ${p.lastUpdated ? formatDate(p.lastUpdated) : 'TBD'}</p>
      </div>

      <button class="interest-btn w-full px-3 py-2 text-xs font-semibold rounded-lg transition-colors shadow-sm ${buttonClass}"
              data-id="${p.id}" ${buttonDisabled ? "disabled" : ""}>
        ${buttonLabel}
      </button>
    `;
        li.appendChild(card);
        mobileList.appendChild(li);
    });

    // Append mobile list to container
    cardContainer.appendChild(mobileList);

    syncExportBar();
    syncCheckboxes();
}

/* ─────────────────────────────────────────────────────────
   Event delegation (registered once, handles dynamic content)
───────────────────────────────────────────────────────── */
function initEventDelegation() {
    // Desktop table body — click
    tableBodyDesktop.addEventListener('click', (e) => {
        const btn = e.target.closest('.interest-btn');
        if (btn) {
            e.stopPropagation();
            if (!btn.disabled) {
                openModalWithProject(Number(btn.dataset.id));
                showFormView();
            }
            return;
        }
        if (e.target.closest('.select-cell')) return;
        const row = e.target.closest('tr.row-clickable');
        if (row) openModalWithProject(Number(row.dataset.projectId));
    });

    // Desktop table body — keyboard
    tableBodyDesktop.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.target.closest('.select-cell')) return;
        const row = e.target.closest('tr.row-clickable');
        if (row) openModalWithProject(Number(row.dataset.projectId));
    });

    // Desktop table body — checkbox change
    tableBodyDesktop.addEventListener('change', (e) => {
        const cb = e.target.closest('.select-checkbox');
        if (cb) toggleSelection(Number(cb.dataset.id));
    });

    // Card container — click
    cardContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.interest-btn');
        if (btn) {
            if (!btn.disabled) {
                openModalWithProject(Number(btn.dataset.id));
                showFormView();
            }
            return;
        }
        const titleBtn = e.target.closest('.card-title-btn');
        if (titleBtn) {
            openModalWithProject(Number(titleBtn.dataset.id));
            return;
        }
    });

    // Card container — checkbox change
    cardContainer.addEventListener('change', (e) => {
        const cb = e.target.closest('.select-checkbox');
        if (cb) toggleSelection(Number(cb.dataset.id));
    });
}