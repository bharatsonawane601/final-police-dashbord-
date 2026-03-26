// ─── Data Page — Connect, CRUD, Pagination, Search ───────────
let currentPage = 1;
const PAGE_LIMIT = 30;
let currentFilters = {};
let isConnected = false;

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Run initApp first to authenticate and set up nav/user display,
    // then run page-specific logic in the callback
    initApp({
        onReady: () => {
            // Redirect viewers away from data page
            if (window.userRole === 'viewer') {
                window.location.href = '/index.html';
                return;
            }
            bindEvents();
            checkConnection();

            // Listen for SSE data updates to refresh this page
            window.addEventListener('z1cis-data-updated', () => {
                if (isConnected) {
                    loadRecords();
                    loadFilterOptions();
                }
            });
        }
    });
});

// ─── Check Connection Status ─────────────────────────────────
async function checkConnection() {
    try {
        const res = await fetch('/api/settings', { credentials: 'same-origin' });
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const settings = await res.json();

        if (settings.connected) {
            showConnectedView(settings);
        } else {
            showConnectScreen();
        }
    } catch (err) {
        showConnectScreen();
    }
}

function showConnectScreen() {
    isConnected = false;
    document.getElementById('connectScreen').style.display = '';
    document.getElementById('connectedView').style.display = 'none';
}

function showConnectedView(settings) {
    isConnected = true;
    document.getElementById('connectScreen').style.display = 'none';
    document.getElementById('connectedView').style.display = '';

    document.getElementById('currentFilePath').textContent = settings.excelPath;
    document.getElementById('totalRecords').textContent = settings.recordCount;

    // Role-based UI: hide editor controls for viewers
    applyRoleRestrictions();

    loadFilterOptions();
    loadRecords();
}

// ─── Role-Based UI ───────────────────────────────────────────
function applyRoleRestrictions() {
    const isViewer = window.userRole === 'viewer';

    // Hide/show editor-only buttons
    const editorElements = [
        'btnAddRecord', 'btnUpload', 'btnReload',
        'btnDisconnect', 'btnConnect', 'btnUploadConnect'
    ];
    editorElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isViewer ? 'none' : '';
    });

    // Show read-only notice for viewers
    let notice = document.getElementById('readOnlyNotice');
    if (isViewer) {
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'readOnlyNotice';
            notice.className = 'read-only-notice';
            notice.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Read-only access — Contact admin2 for edit permissions</span>
            `;
            const toolbar = document.querySelector('.data-toolbar');
            if (toolbar) toolbar.parentNode.insertBefore(notice, toolbar.nextSibling);
        }
        notice.style.display = 'flex';
    } else if (notice) {
        notice.style.display = 'none';
    }

    // Also hide connect screen controls for viewer
    if (isViewer) {
        const connectScreen = document.getElementById('connectScreen');
        if (connectScreen) {
            connectScreen.querySelector('.connect-input-row')?.style && (connectScreen.querySelector('.connect-input-row').style.display = 'none');
            connectScreen.querySelector('.connect-hint')?.style && (connectScreen.querySelector('.connect-hint').style.display = 'none');
            connectScreen.querySelector('#btnUploadConnect')?.style && (connectScreen.querySelector('#btnUploadConnect').style.display = 'none');
        }
    }
}

// ─── Bind UI Events ──────────────────────────────────────────
function bindEvents() {
    // Connect
    document.getElementById('btnConnect').addEventListener('click', handleConnect);
    document.getElementById('connectPathInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConnect();
    });

    // Upload from connect screen
    document.getElementById('fileInputConnect').addEventListener('change', handleFileUpload);
    document.getElementById('btnUploadConnect').addEventListener('click', () => {
        document.getElementById('fileInputConnect').click();
    });

    // Disconnect
    document.getElementById('btnDisconnect').addEventListener('click', handleDisconnect);

    // Search
    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentFilters.search = e.target.value || undefined;
            currentPage = 1;
            loadRecords();
        }, 300);
    });

    // Filters
    ['filterYear', 'filterMonth', 'filterStation', 'filterCrimeType'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            const key = { filterYear: 'year', filterMonth: 'month', filterStation: 'station', filterCrimeType: 'crimeType' }[id];
            currentFilters[key] = e.target.value || undefined;
            currentPage = 1;
            loadRecords();
        });
    });

    // Pagination
    document.getElementById('btnPrev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadRecords(); } });
    document.getElementById('btnNext').addEventListener('click', () => { currentPage++; loadRecords(); });

    // Add Record
    document.getElementById('btnAddRecord').addEventListener('click', () => openModal());

    // Modal
    document.getElementById('btnModalClose').addEventListener('click', closeModal);
    document.getElementById('btnCancel').addEventListener('click', closeModal);
    document.getElementById('recordModal').addEventListener('click', (e) => {
        if (e.target.id === 'recordModal') closeModal();
    });

    // Form submit
    document.getElementById('recordForm').addEventListener('submit', handleFormSubmit);

    // Upload (connected view)
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('btnUpload').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    // Export
    document.getElementById('btnExport').addEventListener('click', () => {
        window.location.href = '/api/export';
        showToast('Exporting data...', 'info');
    });

    // Reload
    document.getElementById('btnReload').addEventListener('click', handleReload);

    initStationDropdown();
    initCrimeTypeDropdown();
}

// ─── Custom Station Dropdown ─────────────────────────────────
function initStationDropdown() {
    const trigger = document.getElementById('dropdownTrigger');
    const menu = document.getElementById('dropdownMenu');
    const search = document.getElementById('dropdownSearch');
    const options = document.getElementById('dropdownOptions');
    const empty = document.getElementById('dropdownEmpty');
    const hidden = document.getElementById('formStation');
    if (!trigger || !menu) return;

    function openDropdown() {
        trigger.classList.add('open');
        menu.classList.add('open');
        search.value = '';
        filterOptions('');
        setTimeout(() => search.focus(), 50);
    }

    function closeDropdown() {
        trigger.classList.remove('open');
        menu.classList.remove('open');
    }

    function selectOption(li) {
        const val = li.dataset.value;
        hidden.value = val;
        const textEl = trigger.querySelector('.dropdown-trigger-text');
        textEl.textContent = val;
        textEl.classList.remove('placeholder');
        options.querySelectorAll('li').forEach(l => l.classList.remove('selected'));
        li.classList.add('selected');
        closeDropdown();
    }

    function filterOptions(query) {
        const q = query.toLowerCase();
        let visible = 0;
        options.querySelectorAll('li').forEach(li => {
            const match = li.textContent.toLowerCase().includes(q);
            li.classList.toggle('hidden', !match);
            if (match) visible++;
        });
        empty.style.display = visible === 0 ? '' : 'none';
    }

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        if (menu.classList.contains('open')) closeDropdown();
        else openDropdown();
    });

    search.addEventListener('input', () => filterOptions(search.value));

    options.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li) selectOption(li);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#stationDropdown')) closeDropdown();
    });

    // Keyboard navigation
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
        if (e.key === 'Enter') {
            const first = options.querySelector('li:not(.hidden)');
            if (first) selectOption(first);
        }
    });
}

function setStationDropdownValue(value) {
    const hidden = document.getElementById('formStation');
    const trigger = document.getElementById('dropdownTrigger');
    const options = document.getElementById('dropdownOptions');
    if (!hidden || !trigger) return;

    hidden.value = value || '';
    const textEl = trigger.querySelector('.dropdown-trigger-text');

    if (value) {
        textEl.textContent = value;
        textEl.classList.remove('placeholder');
    } else {
        textEl.textContent = '— Select Station —';
        textEl.classList.add('placeholder');
    }

    if (options) {
        options.querySelectorAll('li').forEach(li => {
            li.classList.toggle('selected', li.dataset.value === value);
            li.classList.remove('hidden');
        });
    }
}

// ─── Custom Crime Type Dropdown ──────────────────────────────
function initCrimeTypeDropdown() {
    const trigger = document.getElementById('crimeDropdownTrigger');
    const menu = document.getElementById('crimeDropdownMenu');
    const search = document.getElementById('crimeDropdownSearch');
    const optionsList = document.getElementById('crimeDropdownOptions');
    const empty = document.getElementById('crimeDropdownEmpty');
    const hidden = document.getElementById('formCrimeType');
    if (!trigger || !menu) return;

    // Populate crime types from CRIME_TYPE_EN (defined in translations.js)
    const crimeTypes = typeof CRIME_TYPE_EN !== 'undefined' ? Object.keys(CRIME_TYPE_EN) : [];
    optionsList.innerHTML = '';
    crimeTypes.forEach(ct => {
        const li = document.createElement('li');
        li.dataset.value = ct;
        li.textContent = ct;
        optionsList.appendChild(li);
    });

    function openDropdown() {
        trigger.classList.add('open');
        menu.classList.add('open');
        search.value = '';
        filterOptions('');
        setTimeout(() => search.focus(), 50);
    }

    function closeDropdown() {
        trigger.classList.remove('open');
        menu.classList.remove('open');
    }

    function selectOption(li) {
        const val = li.dataset.value;
        hidden.value = val;
        const textEl = trigger.querySelector('.dropdown-trigger-text');
        textEl.textContent = val;
        textEl.classList.remove('placeholder');
        optionsList.querySelectorAll('li').forEach(l => l.classList.remove('selected'));
        li.classList.add('selected');
        closeDropdown();
    }

    function filterOptions(query) {
        const q = query.toLowerCase();
        let visible = 0;
        optionsList.querySelectorAll('li').forEach(li => {
            const match = li.textContent.toLowerCase().includes(q);
            li.classList.toggle('hidden', !match);
            if (match) visible++;
        });
        empty.style.display = visible === 0 ? '' : 'none';
    }

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        if (menu.classList.contains('open')) closeDropdown();
        else openDropdown();
    });

    search.addEventListener('input', () => filterOptions(search.value));

    optionsList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li) selectOption(li);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#crimeTypeDropdown')) closeDropdown();
    });

    search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
        if (e.key === 'Enter') {
            const first = optionsList.querySelector('li:not(.hidden)');
            if (first) selectOption(first);
        }
    });
}

function setCrimeTypeDropdownValue(value) {
    const hidden = document.getElementById('formCrimeType');
    const trigger = document.getElementById('crimeDropdownTrigger');
    const optionsList = document.getElementById('crimeDropdownOptions');
    if (!hidden || !trigger) return;

    hidden.value = value || '';
    const textEl = trigger.querySelector('.dropdown-trigger-text');

    if (value) {
        textEl.textContent = value;
        textEl.classList.remove('placeholder');
    } else {
        textEl.textContent = '— Select Crime Type —';
        textEl.classList.add('placeholder');
    }

    if (optionsList) {
        optionsList.querySelectorAll('li').forEach(li => {
            li.classList.toggle('selected', li.dataset.value === value);
            li.classList.remove('hidden');
        });
    }
}

// ─── Connect ─────────────────────────────────────────────────
async function handleConnect() {
    const pathInput = document.getElementById('connectPathInput');
    // Strip surrounding quotes (user may paste from File Explorer)
    const filePath = pathInput.value.trim().replace(/^"|"$/g, '');

    if (!filePath) {
        showToast('Please enter a file path', 'error');
        pathInput.focus();
        return;
    }

    showToast('Connecting...', 'info');

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ filePath })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Connected! Loaded ${data.count} records`, 'success');
            showConnectedView({
                excelPath: data.path,
                recordCount: data.count
            });
        } else {
            showToast(data.error || 'Connection failed', 'error');
        }
    } catch (err) {
        showToast('Connection failed', 'error');
    }
}

// ─── Disconnect ──────────────────────────────────────────────
function handleDisconnect() {
    showConfirmModal(
        'Disconnect Data Source',
        'The database will be cleared and all records removed. You can reconnect later.',
        async () => {
            try {
                await fetch('/api/disconnect', { method: 'POST', credentials: 'same-origin' });
                showToast('Data source disconnected', 'info');
                showConnectScreen();
            } catch (err) {
                showToast('Error disconnecting', 'error');
            }
        }
    );
}

// ─── Load Filter Options ─────────────────────────────────────
async function loadFilterOptions() {
    try {
        const res = await fetch(`/api/data?_t=${Date.now()}`, { credentials: 'same-origin' });
        const data = await res.json();
        const filters = data.filters;

        populateSelect('filterYear', filters.years, 'All Years');
        populateSelect('filterMonth', filters.months.map(m => ({ value: m, label: getMonthName(m) })), 'All Months');
        populateSelect('filterStation', filters.stations, 'All Stations');
        populateSelect('filterCrimeType', filters.crimeTypes, 'All Crime Types');
    } catch (err) {
        console.error('Error loading filters:', err);
    }
}

function populateSelect(id, options, defaultLabel) {
    const select = document.getElementById(id);
    select.innerHTML = `<option value="">${defaultLabel}</option>`;
    options.forEach(opt => {
        const value = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.label : opt;
        select.innerHTML += `<option value="${value}">${label}</option>`;
    });
}

function getMonthName(m) {
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[m] || m;
}

// ─── Load Records (Paginated) ────────────────────────────────
async function loadRecords() {
    try {
        const params = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT, _t: Date.now() });
        Object.entries(currentFilters).forEach(([k, v]) => { if (v) params.append(k, v); });

        const res = await fetch(`/api/records?${params}`, { credentials: 'same-origin' });
        const data = await res.json();

        renderTable(data.records);
        renderPagination(data);
        document.getElementById('totalRecords').textContent = data.total;

        document.getElementById('emptyState').style.display = data.records.length === 0 ? 'flex' : 'none';
        document.getElementById('dataTable').style.display = data.records.length === 0 ? 'none' : '';
    } catch (err) {
        console.error('Error loading records:', err);
        showToast('Error loading records', 'error');
    }
}

// ─── Render Table ────────────────────────────────────────────
function renderTable(records) {
    const tbody = document.getElementById('tableBody');
    const fragment = document.createDocumentFragment();
    tbody.innerHTML = '';

    const isViewer = window.userRole === 'viewer';

    records.forEach((rec, idx) => {
        const row = document.createElement('tr');
        row.dataset.id = rec.id;
        // Store record data for quick edit modal population
        row.dataset.year = rec.year;
        row.dataset.month = rec.month;
        row.dataset.station = rec.police_station;
        row.dataset.crimeType = rec.crime_type;
        row.dataset.investigation = rec.under_investigation;
        row.dataset.closed = rec.closed;

        row.innerHTML = `
            <td class="cell-num">${(currentPage - 1) * PAGE_LIMIT + idx + 1}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="year">${rec.year}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="month">${rec.month}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="police_station">${rec.police_station}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="crime_type">${rec.crime_type}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="under_investigation">${rec.under_investigation}</td>
            <td class="${isViewer ? '' : 'cell-editable'}" data-field="closed">${rec.closed}</td>
            <td class="cell-actions">
                ${isViewer ? '' : `
                <button class="btn-icon btn-edit" title="Edit" data-action="edit" data-record-id="${rec.id}">
                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon btn-delete" title="Delete" data-action="delete" data-record-id="${rec.id}">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
                `}
            </td>
        `;

        if (!isViewer) {
            row.querySelectorAll('.cell-editable').forEach(cell => {
                cell.addEventListener('dblclick', () => startInlineEdit(cell, rec.id));
            });
        }

        fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
}

// ─── Event Delegation for Edit / Delete buttons ──────────────
(function initTableDelegation() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
        // Find the closest button with a data-action
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const recordId = parseInt(btn.dataset.recordId, 10);
        if (!recordId) return;

        if (action === 'edit') {
            openModal(recordId);
        } else if (action === 'delete') {
            deleteRecord(recordId);
        }
    });
})();

// ─── Inline Editing ──────────────────────────────────────────
function startInlineEdit(cell, recordId) {
    if (window.userRole === 'viewer') return;
    if (cell.classList.contains('editing')) return;

    const field = cell.dataset.field;
    const oldValue = cell.textContent;
    cell.classList.add('editing');

    const input = document.createElement('input');
    input.type = ['year', 'month', 'under_investigation', 'closed'].includes(field) ? 'number' : 'text';
    input.value = oldValue;
    input.className = 'inline-edit-input';

    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newValue = input.value;
        cell.classList.remove('editing');

        if (newValue === oldValue) { cell.textContent = oldValue; return; }
        cell.textContent = newValue;

        try {
            await fetch(`/api/records/${recordId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ [field]: newValue })
            });
            showToast('Record updated', 'success');
        } catch (err) {
            cell.textContent = oldValue;
            showToast('Error updating record', 'error');
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { cell.textContent = oldValue; cell.classList.remove('editing'); }
    });
}

// ─── Pagination ──────────────────────────────────────────────
function renderPagination(data) {
    document.getElementById('pageInfo').textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    document.getElementById('btnPrev').disabled = data.page <= 1;
    document.getElementById('btnNext').disabled = data.page >= data.totalPages;
}

// ─── Modal (Add / Edit) ─────────────────────────────────────
function openModal(editId) {
    const modal = document.getElementById('recordModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('recordForm');

    form.reset();
    document.getElementById('editRecordId').value = '';

    if (editId) {
        title.textContent = 'Edit Record';
        const row = document.querySelector(`tr[data-id="${editId}"]`);
        if (row) {
            document.getElementById('editRecordId').value = editId;
            document.getElementById('formYear').value = row.dataset.year;
            document.getElementById('formMonth').value = row.dataset.month;
            setStationDropdownValue(row.dataset.station);
            setCrimeTypeDropdownValue(row.dataset.crimeType);
            document.getElementById('formInvestigation').value = row.dataset.investigation;
            document.getElementById('formClosed').value = row.dataset.closed;
        } else {
            showToast('Record not found in table', 'error');
            return;
        }
    } else {
        title.textContent = 'Add Record';
        document.getElementById('formYear').value = new Date().getFullYear();
        document.getElementById('formMonth').value = new Date().getMonth() + 1;
        setStationDropdownValue('');
        setCrimeTypeDropdownValue('');
    }

    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('recordModal').style.display = 'none';
}

// ─── Form Submit (Add / Edit) ────────────────────────────────
async function handleFormSubmit(e) {
    e.preventDefault();

    const editId = document.getElementById('editRecordId').value;
    const payload = {
        year: document.getElementById('formYear').value,
        month: document.getElementById('formMonth').value,
        police_station: document.getElementById('formStation').value,
        crime_type: document.getElementById('formCrimeType').value,
        under_investigation: document.getElementById('formInvestigation').value,
        closed: document.getElementById('formClosed').value
    };

    try {
        if (editId) {
            await fetch(`/api/records/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            showToast('Record updated successfully', 'success');
        } else {
            await fetch('/api/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            showToast('Record added successfully', 'success');
        }

        closeModal();
        loadRecords();
        loadFilterOptions();
    } catch (err) {
        showToast('Error saving record', 'error');
    }
}

// ─── Delete Record ───────────────────────────────────────────
function deleteRecord(id) {
    showConfirmModal(
        'Delete Record',
        'This record will be permanently removed. This cannot be undone.',
        async () => {
            try {
                await fetch(`/api/records/${id}`, { method: 'DELETE', credentials: 'same-origin' });
                showToast('Record deleted', 'success');
                loadRecords();
            } catch (err) {
                showToast('Error deleting record', 'error');
            }
        }
    );
}

// ─── File Upload ─────────────────────────────────────────────
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    showToast('Uploading and importing...', 'info');

    try {
        const res = await fetch('/api/upload-excel', { method: 'POST', credentials: 'same-origin', body: formData });
        const data = await res.json();

        if (data.success) {
            showToast(`Imported ${data.count} records`, 'success');
            checkConnection(); // Refresh entire view
        } else {
            showToast('Import failed: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Upload failed', 'error');
    }

    e.target.value = '';
}

// ─── Reload from Excel ───────────────────────────────────────
function handleReload() {
    showConfirmModal(
        'Reload Data',
        'All data will be reloaded from the Excel file. Any unsaved browser changes will be overwritten.',
        async () => {
            showToast('Reloading from Excel...', 'info');
            try {
                const res = await fetch('/api/reload', { method: 'POST', credentials: 'same-origin' });
                const data = await res.json();
                if (data.success) {
                    showToast(`Reloaded ${data.count} records`, 'success');
                    currentPage = 1;
                    loadRecords();
                    loadFilterOptions();
                } else {
                    showToast('Reload failed: ' + data.error, 'error');
                }
            } catch (err) {
                showToast('Reload failed', 'error');
            }
        }
    );
}

// ─── Styled Confirm Modal ────────────────────────────────────
let _confirmCallback = null;

function showConfirmModal(title, message, onConfirm) {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    _confirmCallback = onConfirm;
    overlay.classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmOverlay').classList.remove('active');
    _confirmCallback = null;
}

// Bind once on page load
(function initConfirmModal() {
    const overlay = document.getElementById('confirmOverlay');
    if (!overlay) return;
    document.getElementById('confirmCancel').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmOk').addEventListener('click', () => {
        const cb = _confirmCallback;
        closeConfirmModal();
        if (cb) cb();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeConfirmModal();
    });
})();

// ─── Toast Notifications ─────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info} <span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

