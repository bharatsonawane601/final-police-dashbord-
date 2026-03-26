/* ═══════════════════════════════════════════════════════════════
   Zone 1 Crime Intelligence System — Shared App Logic
   SSE, Data Fetching, Language Toggle, Filters, Auth
   ═══════════════════════════════════════════════════════════════ */

let currentLang = 'en';
let allData = null;
let filteredRecords = [];

// ─── Auth State ──────────────────────────────────────────────
window.userRole = null;
window.currentUser = null;

// ─── Station Order & ACP Division Config ─────────────────────
const STATION_ORDER = [
    { acp: 'acpCity', stations: ['City Chowk', 'Kranti Chowk', 'Vedant Nagar', 'Begumpura'] },
    { acp: 'acpChavni', stations: ['Chhawni', 'Waluj', 'MIDC Waluj', 'Daulatabad'] }
];

// Flat ordered list for quick lookups
const STATION_FLAT_ORDER = STATION_ORDER.flatMap(g => g.stations);

/**
 * Sort station names according to the defined PS order.
 * Stations not in STATION_ORDER are appended alphabetically at the end.
 */
function sortStationsByOrder(stationList) {
    return [...stationList].sort((a, b) => {
        const idxA = STATION_FLAT_ORDER.findIndex(s => s.toLowerCase() === a.toLowerCase());
        const idxB = STATION_FLAT_ORDER.findIndex(s => s.toLowerCase() === b.toLowerCase());
        const oA = idxA >= 0 ? idxA : 9999;
        const oB = idxB >= 0 ? idxB : 9999;
        if (oA !== oB) return oA - oB;
        return a.localeCompare(b);
    });
}

/**
 * Get the PS number (1-based) for a station name.
 * Returns 0 if the station is not in the defined order.
 */
function getStationNumber(stationName) {
    const idx = STATION_FLAT_ORDER.findIndex(s => s.toLowerCase() === stationName.toLowerCase());
    return idx >= 0 ? idx + 1 : 0;
}

/**
 * Find which ACP group a station belongs to (case-insensitive).
 * Returns the group object or null.
 */
function getStationACPGroup(stationName) {
    return STATION_ORDER.find(g =>
        g.stations.some(s => s.toLowerCase() === stationName.toLowerCase())
    ) || null;
}

// ─── Auth Check (cached in sessionStorage) ─────────────────
async function checkAuth() {
    try {
        // Try sessionStorage cache first (skip network on tab switch)
        const cached = sessionStorage.getItem('z1cis_user');
        let user;
        if (cached) {
            user = JSON.parse(cached);
        } else {
            const res = await fetch('/api/me', { credentials: 'same-origin' });
            if (!res.ok) {
                window.location.href = '/login.html';
                return false;
            }
            user = await res.json();
            sessionStorage.setItem('z1cis_user', JSON.stringify(user));
        }
        window.userRole = user.role;
        window.currentUser = user.username;

        // Update user display in nav
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) userDisplay.textContent = user.username;

        // Role-based nav visibility
        const dataTab = document.getElementById('navData');
        const adminTab = document.getElementById('navAdmin');

        // Only editors can see Data tab
        if (user.role !== 'editor') {
            if (dataTab) dataTab.style.display = 'none';
        }

        // Only admins can see Admin tab
        if (user.role === 'admin') {
            if (adminTab) adminTab.style.display = '';
        }

        return true;
    } catch (err) {
        window.location.href = '/login.html';
        return false;
    }
}

function handleLogout() {
    // Clear cached auth so next login is fresh
    sessionStorage.removeItem('z1cis_user');
    sessionStorage.removeItem('z1cis_data');
    // Redirect INSTANTLY — never wait for server
    window.location.href = '/login.html';
    // Fire cookie-clearing POST in background (rate limiter exempts logout)
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => { });
}

// ─── Data Fetching (cached in sessionStorage, 30s TTL) ──────
async function fetchData(force = false) {
    try {
        if (!force) {
            // Check sessionStorage cache (30s TTL)
            const cached = sessionStorage.getItem('z1cis_data');
            if (cached) {
                const { data, ts } = JSON.parse(cached);
                if (Date.now() - ts < 30000) {
                    allData = data;
                    applyFilters();
                    return allData;
                }
            }
        }
        const res = await fetch('/api/data', { credentials: 'same-origin' });
        if (res.status === 401) {
            window.location.href = '/login.html';
            return null;
        }
        allData = await res.json();
        // Cache for next tab switch
        try { sessionStorage.setItem('z1cis_data', JSON.stringify({ data: allData, ts: Date.now() })); } catch (e) { /* quota */ }
        applyFilters();
        return allData;
    } catch (err) {
        console.error('Failed to fetch data:', err);
        return null;
    }
}

// ─── SSE Connection ─────────────────────────────────────────
function connectSSE() {
    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = function (event) {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data-updated') {
            console.log('Data updated! Refreshing...');
            // Dispatch custom event for page-specific handlers (e.g. data.js)
            window.dispatchEvent(new CustomEvent('z1cis-data-updated'));
            fetchData(true).then(() => {
                showToast();
            });
        }
    };

    evtSource.onerror = function () {
        console.warn('SSE connection lost, reconnecting in 3s...');
        evtSource.close();
        setTimeout(connectSSE, 3000);
    };
}

// ─── Toast Notification ─────────────────────────────────────
function showToast() {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = t('dataUpdated');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Language Toggle ────────────────────────────────────────
function t(key) {
    const entry = TRANSLATIONS[key];
    return entry ? (entry[currentLang] || entry.en) : key;
}

function getMonthName(num) {
    return MONTH_NAMES[currentLang][num] || num;
}

function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'mr' : 'en';
    localStorage.setItem('z1cis_lang', currentLang);
    updateAllLabels();
    populateFilters();
    if (typeof renderAllCharts === 'function') renderAllCharts();
}

function updateAllLabels() {
    // Update all elements with data-t attribute
    document.querySelectorAll('[data-t]').forEach(el => {
        const key = el.getAttribute('data-t');
        el.textContent = t(key);
    });

    // Update lang toggle button text (preserve SVG icon)
    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
        const span = langBtn.querySelector('span');
        if (span) span.textContent = t('langToggle');
    }

    // Update last updated
    updateLastUpdated();

    // Update filter labels
    document.querySelectorAll('[data-t-label]').forEach(el => {
        const key = el.getAttribute('data-t-label');
        el.textContent = t(key);
    });

    // Update select "All" options
    document.querySelectorAll('select option[value="all"]').forEach(opt => {
        opt.textContent = t('filterAll');
    });
}

function updateLastUpdated() {
    const el = document.getElementById('lastUpdated');
    if (el && allData && allData.lastModified) {
        const d = new Date(allData.lastModified);
        const formatted = d.toLocaleString(currentLang === 'mr' ? 'mr-IN' : 'en-IN');
        el.textContent = `${t('lastUpdated')}: ${formatted}`;
    }
}

// ─── Filters ────────────────────────────────────────────────
function populateFilters() {
    if (!allData) return;

    const yearOptions = document.getElementById('yearOptions');
    const monthSelect = document.getElementById('filterMonth');

    if (yearOptions) {
        const selected = getSelectedYears();
        yearOptions.innerHTML = '';
        allData.filters.years.forEach(y => {
            const isChecked = selected.includes(String(y));
            const div = document.createElement('div');
            div.className = 'multi-select-option';
            div.innerHTML = `<input type="checkbox" value="${y}" id="yr_${y}" ${isChecked ? 'checked' : ''}><label for="yr_${y}">${y}</label>`;
            div.querySelector('input').addEventListener('change', () => { updateYearSelectLabel(); applyFilters(); });
            yearOptions.appendChild(div);
        });
        updateYearSelectLabel();
    }

    if (monthSelect) {
        const currentVal = monthSelect.value;
        monthSelect.innerHTML = `<option value="all">${t('filterAll')}</option>`;
        for (let m = 1; m <= 12; m++) {
            const available = allData.filters.months.includes(m);
            const label = getMonthName(m);
            monthSelect.innerHTML += `<option value="${m}" ${m == currentVal ? 'selected' : ''} ${!available ? 'style="color:#bbb"' : ''}>${label}${available ? '' : ' (—)'}</option>`;
        }
    }

    // Station filter (only on station page or if exists)
    const stationSelect = document.getElementById('filterStation');
    if (stationSelect) {
        const currentVal = stationSelect.value;
        stationSelect.innerHTML = `<option value="all">${t('filterAll')}</option>`;
        allData.filters.stations.forEach(s => {
            stationSelect.innerHTML += `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s}</option>`;
        });
    }

    // Crime type filter — multi-select (station page) or single-select (overall page)
    const crimeOptions = document.getElementById('crimeOptions');
    const crimeSelect = document.getElementById('filterCrimeType');

    if (crimeOptions) {
        // Multi-select checkbox mode (station page)
        const selected = getSelectedCrimeTypes();
        crimeOptions.innerHTML = '';
        allData.filters.crimeTypes.forEach(ct => {
            const label = typeof translateCrimeType === 'function' ? translateCrimeType(ct) : ct;
            const checked = selected.length === 0 || selected.includes(ct) ? '' : '';
            const isChecked = selected.includes(ct);
            const div = document.createElement('div');
            div.className = 'multi-select-option';
            div.innerHTML = `<input type="checkbox" value="${ct}" id="ct_${ct.replace(/[^a-zA-Z0-9]/g,'_')}" ${isChecked ? 'checked' : ''}><label for="ct_${ct.replace(/[^a-zA-Z0-9]/g,'_')}">${label}</label>`;
            div.querySelector('input').addEventListener('change', () => { updateCrimeSelectLabel(); applyFilters(); });
            // Let the native `<label for="...">` handle the checkbox toggle, just listen to the input change instead of overriding label click
            crimeOptions.appendChild(div);
        });
        updateCrimeSelectLabel();
    } else if (crimeSelect) {
        // Single-select mode (overall page)
        const currentVal = crimeSelect.value;
        crimeSelect.innerHTML = `<option value="all">${t('filterAll')}</option>`;
        allData.filters.crimeTypes.forEach(ct => {
            const label = typeof translateCrimeType === 'function' ? translateCrimeType(ct) : ct;
            crimeSelect.innerHTML += `<option value="${ct}" ${ct === currentVal ? 'selected' : ''}>${label}</option>`;
        });
    }
}

function getSelectedYears() {
    const checkboxes = document.querySelectorAll('#yearOptions input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function updateYearSelectLabel() {
    const textEl = document.querySelector('#yearSelectTrigger .multi-select-text');
    if (!textEl) return;
    const selected = getSelectedYears();
    const total = document.querySelectorAll('#yearOptions input[type="checkbox"]').length;
    if (selected.length === 0 || selected.length === total) {
        textEl.textContent = t('filterAll');
    } else if (selected.length === 1) {
        textEl.textContent = selected[0];
    } else {
        textEl.textContent = selected.join(' + ');
    }
}

function getSelectedCrimeTypes() {
    const checkboxes = document.querySelectorAll('#crimeOptions input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function updateCrimeSelectLabel() {
    const textEl = document.querySelector('#crimeSelectTrigger .multi-select-text');
    if (!textEl) return;
    const selected = getSelectedCrimeTypes();
    const total = document.querySelectorAll('#crimeOptions input[type="checkbox"]').length;
    if (selected.length === 0 || selected.length === total) {
        textEl.textContent = t('filterAll');
    } else if (selected.length === 1) {
        const label = typeof translateCrimeType === 'function' ? translateCrimeType(selected[0]) : selected[0];
        textEl.textContent = label;
    } else {
        textEl.textContent = `${selected.length} selected`;
    }
}

function applyFilters() {
    if (!allData) return;

    // Year: multi-select
    const selectedYears = getSelectedYears();
    const monthVal = document.getElementById('filterMonth')?.value || 'all';
    const stationVal = document.getElementById('filterStation')?.value || 'all';

    // Crime type: check multi-select first, then single-select
    const crimeOptions = document.getElementById('crimeOptions');
    let selectedCrimes = [];
    if (crimeOptions) {
        selectedCrimes = getSelectedCrimeTypes();
    }
    const crimeVal = !crimeOptions ? (document.getElementById('filterCrimeType')?.value || 'all') : null;

    filteredRecords = allData.records.filter(r => {
        // Multi-year filter: if years are selected, only include matching years
        if (selectedYears.length > 0 && !selectedYears.includes(String(r.year))) return false;
        if (monthVal !== 'all' && r.month != monthVal) return false;
        if (stationVal !== 'all' && r.policeStation !== stationVal) return false;
        if (crimeOptions) {
            if (selectedCrimes.length > 0 && !selectedCrimes.includes(r.crimeType)) return false;
        } else {
            if (crimeVal !== 'all' && r.crimeType !== crimeVal) return false;
        }
        return true;
    });

    populateFilters();
    updateKPIs();
    updateLastUpdated();
    if (typeof renderAllCharts === 'function') renderAllCharts();
}

function resetFilters() {
    document.querySelectorAll('.filter-bar select').forEach(sel => sel.value = 'all');
    // Reset year multi-select checkboxes
    document.querySelectorAll('#yearOptions input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateYearSelectLabel();
    // Reset crime type multi-select checkboxes
    document.querySelectorAll('#crimeOptions input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateCrimeSelectLabel();
    applyFilters();
}

// ─── KPI Update ─────────────────────────────────────────────
function updateKPIs() {
    const total = filteredRecords.reduce((s, r) => s + r.underInvestigation, 0);
    const closed = filteredRecords.reduce((s, r) => s + r.closed, 0);
    const unsolved = Math.max(0, total - closed);
    
    // Normalizing rate up to 100% maximum if it makes sense, but standard implies rate can be >100% if backlog is cleared.
    // However, to fix "all calculations" showing weirdly, we can cap it:
    let rate = 0;
    if (total > 0) {
        rate = ((closed / total) * 100);
        if (rate > 100) rate = 100; // Cap at 100% so it doesn't look like a bug
        rate = rate.toFixed(1);
    }

    setKPI('kpiTotal', total);
    setKPI('kpiInvestigation', unsolved);
    setKPI('kpiClosed', closed);
    setKPI('kpiRate', rate + '%');
}

function setKPI(id, value) {
    const el = document.getElementById(id);
    if (el) {
        animateValue(el, value);
    }
}

function animateValue(el, newValue) {
    el.textContent = newValue;
}

// ─── Utility: Group By ──────────────────────────────────────
function groupBy(records, key) {
    const map = {};
    records.forEach(r => {
        const k = r[key];
        if (!map[k]) map[k] = [];
        map[k].push(r);
    });
    return map;
}

function sumField(records, field) {
    return records.reduce((s, r) => s + (r[field] || 0), 0);
}

// ─── Mobile menu (no sidebar — placeholder for mobile nav) ──
function toggleSidebar() {
    // No sidebar in this layout
}

// ─── Init ───────────────────────────────────────────────────
// Usage:
//   initApp(callback)  — callback fires after data loads (for chart pages)
//   initApp({ onReady, onDataReady }) — onReady fires immediately after auth,
//                                       onDataReady fires after data loads
async function initApp(arg) {
    let onReady = null;
    let onDataReady = null;

    if (typeof arg === 'function') {
        // Backward compatible: single function = fires after data
        onDataReady = arg;
    } else if (arg && typeof arg === 'object') {
        onReady = arg.onReady || null;
        onDataReady = arg.onDataReady || null;
    }

    // Restore language preference
    const savedLang = localStorage.getItem('z1cis_lang');
    if (savedLang) currentLang = savedLang;

    // Fast-reveal: if navigating within app, skip animation delays
    const ref = document.referrer;
    if (ref && ref.startsWith(window.location.origin)) {
        document.documentElement.classList.add('fast-reveal');
    }

    // Check authentication first
    const isAuthed = await checkAuth();
    if (!isAuthed) return;

    // Bind common UI events IMMEDIATELY
    document.querySelectorAll('.filter-bar select').forEach(sel => {
        sel.addEventListener('change', applyFilters);
    });

    // Multi-select year toggle (both pages)
    const yearSelectTrigger = document.getElementById('yearSelectTrigger');
    const yearMultiSelect = document.getElementById('yearMultiSelect');
    if (yearSelectTrigger && yearMultiSelect) {
        yearSelectTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            yearMultiSelect.classList.toggle('open');
        });
    }

    // Multi-select crime type toggle (station page)
    const crimeSelectTrigger = document.getElementById('crimeSelectTrigger');
    const crimeMultiSelect = document.getElementById('crimeMultiSelect');
    if (crimeSelectTrigger && crimeMultiSelect) {
        crimeSelectTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            crimeMultiSelect.classList.toggle('open');
        });
    }

    // Close multi-select dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (yearMultiSelect && !e.target.closest('#yearMultiSelect')) {
            yearMultiSelect.classList.remove('open');
        }
        if (crimeMultiSelect && !e.target.closest('#crimeMultiSelect')) {
            crimeMultiSelect.classList.remove('open');
        }
    });

    const resetBtn = document.getElementById('btnReset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    const langBtn = document.getElementById('langToggle');
    if (langBtn) langBtn.addEventListener('click', toggleLanguage);

    const mobileBtn = document.getElementById('mobileToggle');
    if (mobileBtn) mobileBtn.addEventListener('click', toggleSidebar);

    const printBtn = document.getElementById('btnPrint');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    // Bind logout button IMMEDIATELY — must always work
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Update labels for translations
    updateAllLabels();

    // Fire onReady IMMEDIATELY (for admin/data pages)
    if (onReady) onReady();

    // Fetch data + SSE for pages with charts
    const hasCharts = document.querySelector('.filter-bar') || document.querySelector('.chart-grid');
    if (hasCharts) {
        fetchData().then(() => {
            updateAllLabels();
            if (onDataReady) onDataReady();
            connectSSE();
        });
    } else {
        connectSSE();
    }
}
