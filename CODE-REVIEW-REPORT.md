<!--
  Copyright (c) 2026 Brian Pitts, MD, MS, MEHP. All rights reserved.
-->

# Code Review & Production-Readiness Report

**Project:** Research Opportunities Hub (UC Davis demo)
**Reviewed:** 2026-06-16
**Reviewer:** Automated code review (Claude Code)
**Scope:** `index.html`, `js/*.js`, `css/*.css`, build/config files
**App type:** Static, client-only site (no backend). Hard-coded data in `js/data.js`; admin edits → `localStorage`; applications → `sessionStorage`. Labeled "Demo Purposes Only."

---

## 1. Executive Summary

The codebase is **clean, well-organized, and security-conscious for a demo**. HTML output is consistently
escaped, admin overrides are allow-listed and sanitized, and there is genuine accessibility engineering
(focus traps, focus restoration, ARIA state management, a live region, and flash-free dark mode). For a
single-author static site this is above average.

The main issues are: **a large block of dead code** (an entire CSV-export/selection feature that is never
reachable), **a few consistency/hygiene defects**, and a set of **production-readiness gaps** that are
expected for a demo but must be closed before this is used for real applicant intake — chiefly **no backend
to receive submissions** and **security headers delivered only via `<meta>` tags**.

### Severity scoreboard

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 High   | 3 | Dead export subsystem; no submission backend; security headers meta-only |
| 🟡 Medium | 6 | Unused `main.css`; version mismatch; innerHTML re-render; duplicated button logic; admin has no auth; no tests/CI |
| 🟢 Low    | 6 | Empty `img/`; repeated `JSON.parse`; render-blocking scripts; parse-time DOM refs; SEO/metadata; PII disclosure note |

> Severity reflects impact **if this goes to production as a real intake tool**. As a pure demo, most 🔴/🟡
> items are acceptable today and the table doubles as a graduation checklist.

---

## 2. Errors & Dead Code

### 2.1 🔴 Orphaned selection / CSV-export subsystem (~120 lines unreachable)
**Location:** `js/shared-accessible.js:276–467` (and calls at `:738`, `:865`)

`shared-accessible.js` implements a complete multi-select + CSV-export feature:
`toggleSelection`, `selectAllVisible`, `clearSelection`, `syncExportBar`, `syncCheckboxes`,
`generateCsv`, `downloadCsv`, `downloadSelectedCsv`, `downloadAllCsv`, `csvEscape`, `csvFilename`, and the
`selectedIds` Set. The renderers gate row checkboxes on
`const hasExportBar = !!document.getElementById('exportBar')` (`:747`).

**The problem:** `index.html` contains **no** `#exportBar`, `#selectedCount`, or `#selectAllDesktop`
elements (verified: 0 matches). Therefore `hasExportBar` is always `false`, checkboxes never render, and
**none** of the selection/CSV code is reachable. `syncExportBar()`/`syncCheckboxes()` run on every render
but no-op (they early-return on the missing `#exportBar`/`#selectAllDesktop`).

**Why it matters:** ~120 lines of untested, unreachable code is a maintenance and security-surface liability
(the CSV path even has a formula-injection guard for a feature nobody can trigger). It also misleads the next
reader into thinking export works.

**Recommendation — pick one:**
- **(A) Delete it.** Remove the selection/CSV functions, `selectedIds`, the `hasExportBar` branches in
  `renderAll`, and the `syncExportBar`/`syncCheckboxes` calls. Smallest, safest change.
- **(B) Wire it up.** The code is well-written; add the `#exportBar` / `#selectedCount` / `#selectAllDesktop`
  markup + "Export CSV" buttons and ship it as a real feature. Worthwhile if exporting the listing is useful
  to faculty/admins.

Leaving it as-is is the only wrong answer.

### 2.2 🟡 `css/main.css` is tracked but never loaded
**Location:** `css/main.css` (tracked in git); `index.html:27` loads only `css/output.css`

Nothing references `main.css` (verified: 0 matches in HTML/JS). It is a stale pre-Tailwind stylesheet.
**Fix:** delete `css/main.css`.

### 2.3 🟡 Version mismatch
**Location:** `package.json:3` (`"version": "1.0.0"`) vs `index.html:250` footer (`v1.1`) and the v1.1 report title.
**Fix:** bump `package.json` to `1.1.0` and keep a single source of truth for the version string.

### 2.4 🟢 Empty `img/` directory and no favicon
`img/` is committed empty, and no `<link rel="icon">` is declared, so browsers request `/favicon.ico` and 404.
**Fix:** add a favicon (and use `img/`) or remove the empty directory.

---

## 3. Optimization & Best-Practice Opportunities

### 3.1 🟡 Full re-render via `innerHTML` string building
**Location:** `js/shared-accessible.js:725` (`renderAll`)

Every filter/search/sort rebuilds **both** the desktop table and the mobile card list by concatenating large
HTML strings and assigning `innerHTML`. At the current 12 rows this is imperceptible (and search is debounced
200 ms, `init-accessible.js:214`), so **no action is required today**.

**If the dataset grows** (dozens–hundreds of rows) this becomes the obvious bottleneck. Best-practice path:
build into a `DocumentFragment` (or `<template>` clone) and append once; consider diffing instead of full
teardown. Note the ceiling so it isn't a surprise later.

### 3.2 🟡 Duplicated button-state logic (drift risk)
**Location:** `js/shared-accessible.js:556–578` (`showDetailsView`) and `:764–774` (`renderAll`)

The Apply / Full / Applied / Completed / "Not Available" decision is computed **twice**, with slightly
different shapes (`showDetailsView` uses an if/else chain mutating `goBtn`; `renderAll` uses nested ternaries
producing `buttonLabel`/`buttonDisabled`/`buttonClass`). These can drift out of sync.

**Fix:** extract one helper, e.g. `computeApplyState(p, applied) → { label, disabled, variant }`, and have both
call sites consume it. Single source of truth for the most important interactive state in the app.

### 3.3 🟢 Repeated `JSON.parse` of storage inside the filter loop
**Location:** `loadApplications`/`hasApplied` (`js/shared-accessible.js:171`, `:210`) called from
`filterAndRender` (`:682`) when the email filter is active

When `emailFilterActive` is on, the filter calls `hasApplied()` per project, each re-`JSON.parse`-ing
`sessionStorage`. Negligible at this scale, but the pattern is O(n) parses per render.
**Fix:** parse applications once per render and pass the object into the predicate.

### 3.4 🟢 Render-blocking scripts; no JS minification
**Location:** `index.html:551–553` (and `:22–23`)

`data.js`, `shared-accessible.js`, `init-accessible.js` are plain `<script>` tags at end of `<body>`
(so they don't block first paint), but adding `defer` makes intent explicit and is strictly better.
The build (`package.json`) only minifies CSS; JS ships unminified.
**Fix:** add `defer` to the three body scripts; add a JS minify step if a build pipeline is introduced.
(`frame-guard.js` and `theme-init.js` in `<head>` are intentionally render-blocking — leave them.)

### 3.5 🟢 DOM refs resolved at parse time
**Location:** `js/shared-accessible.js:326–383`

Dozens of `const x = document.getElementById(...)` run at module top level. This works **only** because the
scripts are loaded at the end of `<body>`. It's fragile if a script is ever moved to `<head>` or loaded
`async`. Low priority; if touched, resolve refs inside an `init()` guarded by `DOMContentLoaded`.

---

## 4. Production-Readiness Gaps

These are the items to close before the site is used for **real** applicant intake (vs. demonstration).

### 4.1 🔴 No backend — submissions go nowhere
**Location:** `js/init-accessible.js:61–103` (submit handler); `js/shared-accessible.js:224` (`recordApplication`)

On submit, the application is written to `sessionStorage` and the UI shows "Submitted!". The modal itself says
*"submissions last for this browser session only."* No email is sent, no record reaches the project contact,
and the data is **lost when the tab closes**. This is correct for a demo but is the **#1 blocker** for real use.
**Fix for production:** POST to a real endpoint — a serverless function emailing the contact, a form provider
(Formspree/Basin), or an API + database. Add server-side validation, spam protection (rate limit / CAPTCHA),
and a delivery-failure path so applicants aren't told "Submitted!" when nothing was sent.

### 4.2 🔴 Security headers are `<meta>`-only
**Location:** `index.html:16–19`; `js/frame-guard.js`

CSP, `X-Content-Type-Options`, referrer, and permissions policies are delivered via `<meta http-equiv>`.
Two issues: **(a)** `frame-ancestors 'none'` is **ignored** when set via `<meta>` — it only works as an HTTP
response header — so clickjacking protection currently relies on the weaker JS frame-buster (`frame-guard.js`),
which can be defeated by a sandboxed iframe. **(b)** Several protections (HSTS, a robust CSP, `X-Frame-Options`)
can only be set server-side.
**Fix for production:** serve real HTTP headers from the host (Netlify `_headers`, Cloudflare/Vercel config,
or nginx): `Content-Security-Policy`, `X-Frame-Options: DENY`, `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`. Keep the `<meta>` CSP as defense-in-depth.

### 4.3 🟡 Admin mode has no authentication
**Location:** `js/init-accessible.js:188–190` (`?admin=true` reveals the admin panel)

The admin panel is gated only by a URL query param. This is **not a vulnerability today** because edits only
write to the **visitor's own** `localStorage` (allow-listed + sanitized via `sanitizeOverride`,
`shared-accessible.js:102`) and never affect other users or a server. But it must not be mistaken for access
control. **Fix for production:** if admin edits should be authoritative/shared, move them behind real
authentication and a server; otherwise document clearly that "admin" is a per-browser demo affordance.

### 4.4 🟡 No tests and no CI; build artifact committed
**Location:** `package.json:8` (`test` exits 1); `css/output.css` (committed)

There is no test suite and no CI. The compiled `css/output.css` is committed to the repo (fine for zero-build
static hosting, but it drifts from `css/input.css` if someone forgets to rebuild).
**Fix:** add a minimal CI that runs `npm run build:css` and basic checks (HTML validate, link/asset check, a
smoke test of the filter/modal logic). Either `.gitignore` the built CSS and build in CI, or add a comment
documenting that it is intentionally committed for the host.

### 4.5 🟢 SEO / social / PWA metadata gaps
**Location:** `index.html:13–28` (`<head>`)

Missing `<meta name="description">`, Open Graph / Twitter card tags, canonical URL, favicon, and web manifest.
Low priority for an internal demo; worth adding if the page is meant to be shared or indexed. (`robots.txt`
currently `Allow: /` — confirm you actually want a demo indexed.)

### 4.6 🟢 PII handling — document it
**Location:** `js/shared-accessible.js:162–234`

Applicant name, email, and note are stored in `sessionStorage` (deliberately, to limit exposure to the tab
session — a good choice). No PII is logged or sent off-device in the demo. **Fix:** state this explicitly in a
short privacy note so reviewers/users know what is stored and for how long.

---

## 5. Strengths — Keep These

- **Output encoding everywhere:** `escapeHtml` (`shared-accessible.js:33`) is applied to all interpolated
  data in both renderers; `mailto:` hrefs are `encodeURIComponent`-wrapped and validated.
- **CSV formula-injection guard** (`csvEscape:415`) — correct even though the feature is currently unreachable.
- **Defense-in-depth on overrides:** `ALLOWED_OVERRIDE_KEYS` allow-list + `sanitizeOverride` type/range/enum
  checks + numeric ID validation in `loadOverrides`.
- **Genuine accessibility work:** modal focus trap + focus restore (`:611`, `:623`), disclaimer focus trap,
  `aria-expanded` management on dropdowns, skip-to-content link, `aria-live` results announcer, mobile cards
  wrapped in a real `<ul>/<li>`.
- **UX polish:** flash-free dark mode via pre-paint `theme-init.js`, body scroll-lock, 200 ms debounced search,
  `ResizeObserver`-driven sticky header offset.

---

## 6. Prioritized Action Checklist

**Quick wins (low risk, do now):**
- [ ] Resolve the dead export subsystem — delete (2.1A) or wire up (2.1B)
- [ ] Delete unused `css/main.css` (2.2)
- [ ] Fix version mismatch → `1.1.0` (2.3)
- [ ] Add `defer` to the three body scripts (3.4)
- [ ] Add a favicon or remove empty `img/` (2.4)

**Medium (refactor / hygiene):**
- [ ] Extract one `computeApplyState()` helper for button state (3.2)
- [ ] Add SEO/social/favicon metadata to `<head>` (4.5)
- [ ] Add a short PII/privacy note (4.6)
- [ ] Decide CI + committed-CSS policy (4.4)

**Before production (required for real intake):**
- [ ] Add a real submission backend with server-side validation + spam protection (4.1)
- [ ] Serve security headers as HTTP response headers; add `X-Frame-Options`/HSTS (4.2)
- [ ] Put admin edits behind real auth, or document them as a per-browser demo affordance (4.3)
- [ ] Add tests for filter/sort/apply logic and modal flows (4.4)

---

*Generated by automated code review. Every cited `file:line` was checked against the current source. This
report recommends changes only — no code was modified.*
