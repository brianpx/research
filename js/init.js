/* ─────────────────────────────────────────────────────────
   Dropdown wiring
───────────────────────────────────────────────────────── */
document.addEventListener('click', e => {
    if (!e.target.closest('#typeDropdownWrap'))   document.getElementById('typeDropdown').classList.remove('open');
    if (!e.target.closest('#statusDropdownWrap')) document.getElementById('statusDropdown').classList.remove('open');
});
document.getElementById('typeTrigger').addEventListener('click',   () => toggleDropdown('typeDropdown'));
document.getElementById('statusTrigger').addEventListener('click', () => toggleDropdown('statusDropdown'));

/* ─────────────────────────────────────────────────────────
   Admin actions
───────────────────────────────────────────────────────── */
document.getElementById("adminSetToday").addEventListener("click", () => {
    adminLastUpdated.value = new Date().toISOString().split("T")[0];
});
document.getElementById("adminSaveProject").addEventListener("click", () => {
    if (!currentProjectId) return;

    const patch = {
        contactName: adminContactName.value.trim(),
        contactEmail: adminContactEmail.value.trim(),
        durationRange: adminDurationRange.value.trim() || "TBD",
        targetDate: adminTargetDate.value.trim() || "TBD",
        lastUpdated: adminLastUpdated.value || new Date().toISOString().split("T")[0],
        status: adminStatus.value,
        time: adminTime.value.trim() || "TBD",
        studentSlots: Math.max(0, Number(adminStudentSlots.value || 0)),
        residentSlots: Math.max(0, Number(adminResidentSlots.value || 0))
    };

    updateProject(currentProjectId, patch, projectData);
    filterAndRender();
    showDetailsView(currentProjectId);
});
document.getElementById("adminResetProject").addEventListener("click", () => {
    if (!currentProjectId) return;
    const overrides = loadOverrides();
    delete overrides[currentProjectId];
    saveOverrides(overrides);

    const mergedBase = [...baseProjectData, ...tailRows];
    projectData = applyOverrides(mergedBase, overrides);

    filterAndRender();
    showDetailsView(currentProjectId);
});

/* ─────────────────────────────────────────────────────────
   Submission (blocks re-apply)
───────────────────────────────────────────────────────── */
let submitting = false;
signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (submitting) return;
    const p = projectData.find(x => x.id === currentProjectId);
    if (!p) return;

    const fd = new FormData(signupForm);
    const applicantEmail = normalizeEmail(fd.get("email"));

    if (!applicantEmail || !isValidEmail(applicantEmail)) {
        alert("Please enter a valid email address.");
        return;
    }
    if (hasApplied(applicantEmail, currentProjectId)) {
        alert("You've already applied to this project using this email on this device.");
        return;
    }

    submitting = true;
    const submitBtn = signupForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const payload = {
        fullName: (fd.get("fullName") || "").trim(),
        email: (fd.get("email") || "").trim(),
        interestNote: (fd.get("interestNote") || "").trim(),
        projectId: String(currentProjectId),
        projectTitle: p.title
    };

    recordApplication(applicantEmail, currentProjectId, payload);

    setCurrentApplicantEmail(applicantEmail);
    myEmailInput.value = applicantEmail;

    filterAndRender();
    showConfirmView(p.title);

    setTimeout(() => {
        submitting = false;
        if (submitBtn) submitBtn.disabled = false;
    }, 2000);
});

/* ─────────────────────────────────────────────────────────
   Controls
───────────────────────────────────────────────────────── */
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("cancelButton").addEventListener("click", closeModal);
document.getElementById("confirmClose").addEventListener("click", closeModal);
document.getElementById("detailsClose").addEventListener("click", closeModal);

modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });

document.getElementById("goToInterest").addEventListener("click", showFormView);

backToDetailsBtn.addEventListener("click", () => {
    if (currentProjectId) showDetailsView(currentProjectId);
});

/* ─────────────────────────────────────────────────────────
   Init
───────────────────────────────────────────────────────── */
(function init() {
    myEmailInput.value = "";
    emailFilterActive = false;

    function updateEmailBtn() {
        const hasValue = myEmailInput.value.trim().length > 0;
        if (emailFilterActive) {
            emailSearchBtn.textContent = "Clear";
            emailSearchBtn.disabled = false;
            emailSearchBtn.className = "absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium rounded-md bg-red-100 text-red-600 hover:bg-red-200 transition-colors";
        } else if (hasValue) {
            emailSearchBtn.textContent = "Search";
            emailSearchBtn.disabled = false;
            emailSearchBtn.className = "absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer";
        } else {
            emailSearchBtn.textContent = "Search";
            emailSearchBtn.disabled = true;
            emailSearchBtn.className = "absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium rounded-md bg-gray-200 text-gray-400 cursor-not-allowed";
        }
    }

    const emailError = document.getElementById("emailError");

    myEmailInput.addEventListener("input", () => {
        setCurrentApplicantEmail(myEmailInput.value);
        emailError.classList.add("hidden");
        myEmailInput.classList.remove("border-red-500");
        if (emailFilterActive) {
            emailFilterActive = false;
            filterAndRender();
        }
        updateEmailBtn();
    });

    myEmailInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); emailSearchBtn.click(); }
    });

    emailSearchBtn.addEventListener("click", () => {
        if (emailFilterActive) {
            emailFilterActive = false;
            myEmailInput.value = "";
            setCurrentApplicantEmail("");
            emailError.classList.add("hidden");
            myEmailInput.classList.remove("border-red-500");
        } else {
            if (!isValidEmail(myEmailInput.value.trim())) {
                emailError.classList.remove("hidden");
                myEmailInput.classList.add("border-red-500");
                return;
            }
            emailError.classList.add("hidden");
            myEmailInput.classList.remove("border-red-500");
            emailFilterActive = true;
            setCurrentApplicantEmail(myEmailInput.value);
        }
        updateEmailBtn();
        filterAndRender();
    });

    updateEmailBtn();

    // Gate admin panel behind ?admin=true
    if (new URLSearchParams(window.location.search).get('admin') === 'true') {
        document.getElementById('adminPanel').classList.remove('hidden');
    }

    const overrides = loadOverrides();
    const mergedBase = [...baseProjectData, ...tailRows];
    projectData = applyOverrides(mergedBase, overrides);

    filterAndRender();

    /* Sticky thead: pin just below the sticky filter bar */
    (function initStickyThead() {
        const filters = document.getElementById("stickyFilters");
        const thead   = document.getElementById("stickyThead");
        function sync() {
            thead.style.top = filters.offsetHeight + "px";
        }
        sync();
        if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(sync).observe(filters);
        } else {
            window.addEventListener("resize", sync);
        }
    })();

    // Debounced search
    const debouncedFilter = debounce(filterAndRender, 200);
    searchInput.addEventListener("input", debouncedFilter);
    sortSelect.addEventListener("change", filterAndRender);

    document.querySelectorAll(".typeCheck, .statusCheck").forEach(cb =>
        cb.addEventListener("change", filterAndRender)
    );

    // Event delegation
    initEventDelegation();

    // Dark mode toggle
    document.getElementById('darkModeToggle').addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });

    // Type/Status select-all/clear buttons
    document.getElementById('typeSelectAll').addEventListener('click', () => setAll('typeCheck', true));
    document.getElementById('typeClearAll').addEventListener('click', () => setAll('typeCheck', false));
    document.getElementById('statusSelectAll').addEventListener('click', () => setAll('statusCheck', true));
    document.getElementById('statusClearAll').addEventListener('click', () => setAll('statusCheck', false));

    // Disclaimer modal
    const disclaimerModal = document.getElementById('disclaimerModal');
    function closeDisclaimer() { disclaimerModal.classList.add('hidden'); }
    document.getElementById('openDisclaimer').addEventListener('click', () => disclaimerModal.classList.remove('hidden'));
    document.getElementById('closeDisclaimerX').addEventListener('click', closeDisclaimer);
    document.getElementById('closeDisclaimerBtn').addEventListener('click', closeDisclaimer);
    disclaimerModal.addEventListener('click', (e) => { if (e.target === disclaimerModal) closeDisclaimer(); });
})();
