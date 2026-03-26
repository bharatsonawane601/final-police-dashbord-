/* ═══════════════════════════════════════════════════════════════
   Overall Dashboard — 8 Unique Chart Types + Click-to-expand Modal
   ═══════════════════════════════════════════════════════════════ */

let charts = {};
let modalChart = null;

function destroyCharts() {
    Object.values(charts).forEach(c => { if (c && c.destroy) c.destroy(); });
    charts = {};
}

function renderAllCharts() {
    destroyCharts();
    if (!filteredRecords || filteredRecords.length === 0) return;
    renderHotspot();          // 1. Horizontal Bar (heat-colored)
    renderTopCrimes();        // 2. Polar Area
    renderMonthlyTrend();     // 3. Area Chart
    renderDistribution();     // 4. Pie
    renderInvVsClosed();      // 5. Grouped Bar (vertical)
    renderRadar();            // 6. Radar
    renderHeatmap();          // 7. HTML Heatmap Table
    renderClosureRate();      // 8. Doughnut
    bindChartClicks();
}

// ─── Chart defaults ─────────────────────────────────────────
Chart.defaults.font.family = "'Inter', 'Segoe UI', 'Nirmala UI', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#374151';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.tooltip.backgroundColor = '#1f2937';
Chart.defaults.plugins.tooltip.titleColor = '#f9fafb';
Chart.defaults.plugins.tooltip.bodyColor = '#e5e7eb';
Chart.defaults.plugins.tooltip.cornerRadius = 6;
Chart.defaults.plugins.tooltip.padding = 10;

// 24 distinct colors
const PAL = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444',
    '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
    '#f97316', '#3b82f6', '#84cc16', '#e11d48',
    '#0ea5e9', '#a855f7', '#22c55e', '#d946ef',
    '#0d9488', '#eab308', '#7c3aed', '#fb923c',
    '#2563eb', '#059669', '#dc2626', '#6d28d9'
];

const GRID = '#f1f5f9';

// ─── Modal system ───────────────────────────────────────────
const chartRenderers = {};

function bindChartClicks() {
    document.querySelectorAll('.chart-card[data-chart]').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.getAttribute('data-chart');
            const title = card.querySelector('.chart-title')?.textContent || '';
            openModal(key, title);
        });
    });
}

function openModal(key, title) {
    const overlay = document.getElementById('chartModal');
    const titleEl = document.getElementById('modalTitle');
    const canvas = document.getElementById('modalChart');

    titleEl.textContent = title;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (modalChart) { modalChart.destroy(); modalChart = null; }

    setTimeout(() => {
        if (chartRenderers[key]) {
            modalChart = chartRenderers[key](canvas);
        }
    }, 50);
}

function closeModal() {
    const overlay = document.getElementById('chartModal');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (modalChart) { modalChart.destroy(); modalChart = null; }
}

document.getElementById('modalClose')?.addEventListener('click', closeModal);
document.getElementById('chartModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ═══════════════════════════════════════════════════════════════
// 1. CRIME HOTSPOT — Horizontal Bar (heat-colored)
// ═══════════════════════════════════════════════════════════════
function renderHotspot() {
    const cfg = getHotspotConfig();
    charts.hotspot = new Chart(document.getElementById('chartHotspot'), cfg);
    chartRenderers.hotspot = (canvas) => new Chart(canvas, getHotspotConfig());
}

function getHotspotConfig() {
    const grouped = groupBy(filteredRecords, 'policeStation');
    const labels = sortStationsByOrder(Object.keys(grouped));
    const data = labels.map(s => sumField(grouped[s], 'underInvestigation'));
    const max = Math.max(...data);
    const colors = data.map(v => {
        const r = v / max;
        if (r >= 0.75) return '#ef4444';
        if (r >= 0.5) return '#f97316';
        if (r >= 0.25) return '#f59e0b';
        return '#10b981';
    });

    return {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6, barThickness: 24, borderSkipped: false }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            layout: { padding: { right: 30 } },
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: GRID }, ticks: { precision: 0, color: '#374151', font: { size: 12 } } },
                y: { grid: { display: false }, ticks: { color: '#1f2937', font: { size: 12, weight: '500' } } }
            }
        },
        plugins: [{
            id: 'barLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, idx) => {
                        ctx.save();
                        ctx.fillStyle = '#374151';
                        ctx.font = 'bold 12px Inter, sans-serif';
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(ds.data[idx], bar.x + 6, bar.y);
                        ctx.restore();
                    });
                });
            }
        }]
    };
}

// ═══════════════════════════════════════════════════════════════
// 2. TOP CRIMES — Polar Area
// ═══════════════════════════════════════════════════════════════
function renderTopCrimes() {
    const cfg = getTopCrimesConfig();
    charts.topCrimes = new Chart(document.getElementById('chartTopCrimes'), cfg);
    chartRenderers.topCrimes = (canvas) => new Chart(canvas, getTopCrimesConfig());
}

function getTopCrimesConfig() {
    const grouped = groupBy(filteredRecords, 'crimeType');
    const sorted = Object.entries(grouped)
        .map(([ct, recs]) => [ct, sumField(recs, 'underInvestigation')])
        .sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => translateCrimeType(e[0]));
    const data = sorted.map(e => e[1]);
    const total = data.reduce((a, b) => a + b, 0);

    return {
        type: 'polarArea',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: PAL.slice(0, labels.length).map(c => c + 'cc'),
                borderColor: PAL.slice(0, labels.length),
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#1f2937', font: { size: 10 }, boxWidth: 10, padding: 8, usePointStyle: true, pointStyle: 'circle' }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        }
                    }
                }
            },
            scales: {
                r: { ticks: { display: false }, grid: { color: '#e5e7eb' } }
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
// 3. MONTHLY TREND — Area Chart (smooth filled)
// ═══════════════════════════════════════════════════════════════
function renderMonthlyTrend() {
    const cfg = getTrendConfig(document.getElementById('chartMonthlyTrend'));
    charts.trend = new Chart(document.getElementById('chartMonthlyTrend'), cfg);
    chartRenderers.monthlyTrend = (canvas) => new Chart(canvas, getTrendConfig(canvas));
}

function getTrendConfig(canvas) {
    const monthData = {};
    for (let m = 1; m <= 12; m++) monthData[m] = 0;
    filteredRecords.forEach(r => { monthData[r.month] = (monthData[r.month] || 0) + r.underInvestigation; });

    const labels = [], data = [];
    for (let m = 1; m <= 12; m++) { labels.push(getMonthName(m)); data.push(monthData[m]); }

    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, 'rgba(99,102,241,0.25)');
    grad.addColorStop(1, 'rgba(99,102,241,0)');

    return {
        type: 'line',
        data: {
            labels, datasets: [{
                data, borderColor: '#6366f1', backgroundColor: grad,
                fill: true, tension: 0.4,
                pointBackgroundColor: '#6366f1', pointBorderColor: '#fff',
                pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 7,
                borderWidth: 2.5
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: GRID }, ticks: { precision: 0, color: '#374151', font: { size: 11 } } },
                x: { grid: { display: false }, ticks: { color: '#374151', font: { size: 11 } } }
            },
            interaction: { mode: 'index', intersect: false }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
// 4. DISTRIBUTION — Pie Chart
// ═══════════════════════════════════════════════════════════════
function renderDistribution() {
    const cfg = getDistConfig();
    charts.distribution = new Chart(document.getElementById('chartDistribution'), cfg);
    chartRenderers.distribution = (canvas) => new Chart(canvas, getDistConfig());
}

function getDistConfig() {
    const grouped = groupBy(filteredRecords, 'crimeType');
    const sorted = Object.entries(grouped)
        .map(([ct, recs]) => [ct, sumField(recs, 'underInvestigation')])
        .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8);
    const othersCount = sorted.slice(8).reduce((s, e) => s + e[1], 0);

    const labels = top.map(e => translateCrimeType(e[0]));
    const data = top.map(e => e[1]);
    const colors = PAL.slice(0, top.length);

    if (othersCount > 0) {
        labels.push(currentLang === 'mr' ? 'इतर' : 'Others');
        data.push(othersCount);
        colors.push('#9ca3af');
    }

    const total = data.reduce((a, b) => a + b, 0);

    return {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#1f2937', font: { size: 10 }, padding: 8, boxWidth: 10, usePointStyle: true, pointStyle: 'circle' }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw} (${total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0}%)`
                    }
                }
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
// 5. INVESTIGATION vs CLOSED — Grouped Vertical Bar
// ═══════════════════════════════════════════════════════════════
function renderInvVsClosed() {
    const cfg = getInvConfig();
    charts.invVsClosed = new Chart(document.getElementById('chartInvVsClosed'), cfg);
    chartRenderers.invVsClosed = (canvas) => new Chart(canvas, getInvConfig());
}

function getInvConfig() {
    const grouped = groupBy(filteredRecords, 'policeStation');
    const labels = sortStationsByOrder(Object.keys(grouped));
    return {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: t('totalCrimes'),
                    data: labels.map(s => sumField(grouped[s], 'underInvestigation')),
                    backgroundColor: '#6366f1',
                    borderRadius: 4,
                    barPercentage: 0.7,
                    categoryPercentage: 0.6
                },
                {
                    label: t('closedCases'),
                    data: labels.map(s => sumField(grouped[s], 'closed')),
                    backgroundColor: '#10b981',
                    borderRadius: 4,
                    barPercentage: 0.7,
                    categoryPercentage: 0.6
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#1f2937', font: { size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#374151', font: { size: 10 }, maxRotation: 45 } },
                y: { beginAtZero: true, grid: { color: GRID }, ticks: { precision: 0, color: '#374151' } }
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
// 6. RADAR — Crime Density Radar
// ═══════════════════════════════════════════════════════════════
function renderRadar() {
    const cfg = getRadarConfig();
    charts.radar = new Chart(document.getElementById('chartRadar'), cfg);
    chartRenderers.radar = (canvas) => new Chart(canvas, getRadarConfig());
}

function getRadarConfig() {
    const grouped = groupBy(filteredRecords, 'policeStation');
    const labels = sortStationsByOrder(Object.keys(grouped));
    return {
        type: 'radar',
        data: {
            labels,
            datasets: [
                {
                    label: t('totalCrimes'),
                    data: labels.map(s => sumField(grouped[s], 'underInvestigation')),
                    borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
                    borderWidth: 2.5, pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#fff', pointBorderWidth: 1.5, pointRadius: 4
                },
                {
                    label: t('closedCases'),
                    data: labels.map(s => sumField(grouped[s], 'closed')),
                    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)',
                    borderWidth: 2, pointBackgroundColor: '#10b981',
                    pointBorderColor: '#fff', pointBorderWidth: 1.5, pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#1f2937', font: { size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    ticks: { precision: 0, backdropColor: 'transparent', color: '#6b7280', font: { size: 9 } },
                    pointLabels: { color: '#1f2937', font: { size: 11, weight: '500' } },
                    grid: { color: '#e5e7eb' },
                    angleLines: { color: '#e5e7eb' }
                }
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
// 7. HEATMAP — HTML Table
// ═══════════════════════════════════════════════════════════════
function renderHeatmap() {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const grouped = groupBy(filteredRecords, 'policeStation');
    const stations = sortStationsByOrder(Object.keys(grouped));
    const matrix = {};
    let gMax = 0;

    stations.forEach(s => {
        matrix[s] = {};
        for (let m = 1; m <= 12; m++) matrix[s][m] = 0;
        grouped[s].forEach(r => { matrix[s][r.month] += r.underInvestigation; if (matrix[s][r.month] > gMax) gMax = matrix[s][r.month]; });
    });

    let html = '<table class="heatmap-table"><thead><tr>';
    html += `<th>${t('filterStation')}</th>`;
    for (let m = 1; m <= 12; m++) html += `<th>${getMonthName(m).substring(0, 3)}</th>`;
    html += '<th>Total</th></tr></thead><tbody>';

    stations.forEach(s => {
        html += `<tr><td class="station-name">${s}</td>`;
        let rowTotal = 0;
        for (let m = 1; m <= 12; m++) {
            const v = matrix[s][m]; rowTotal += v;
            const bg = heatColor(v, gMax);
            const fg = v > 0 ? '#1f2937' : '#9ca3af';
            html += `<td style="background:${bg};color:${fg}">${v || '—'}</td>`;
        }
        html += `<td style="font-weight:600;color:#1f2937">${rowTotal}</td></tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function heatColor(v, max) {
    if (v === 0 || max === 0) return '#f9fafb';
    const r = v / max;
    if (r < 0.25) return '#eef2ff';
    if (r < 0.5) return '#c7d2fe';
    if (r < 0.75) return '#a5b4fc';
    return '#818cf8';
}

// ═══════════════════════════════════════════════════════════════
// 8. CLOSURE RATE — Doughnut Chart
// ═══════════════════════════════════════════════════════════════
function renderClosureRate() {
    const cfg = getClosureConfig();
    charts.closureRate = new Chart(document.getElementById('chartClosureRate'), cfg);
    chartRenderers.closureRate = (canvas) => new Chart(canvas, getClosureConfig());
}

function getClosureConfig() {
    const grouped = groupBy(filteredRecords, 'policeStation');
    const labels = sortStationsByOrder(Object.keys(grouped));
    const rates = labels.map(s => {
        const total = sumField(grouped[s], 'underInvestigation');
        const cl = sumField(grouped[s], 'closed');
        return total > 0 ? parseFloat(((cl / total) * 100).toFixed(1)) : 0;
    });

    const colors = labels.map((_, i) => PAL[i % PAL.length]);

    return {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: rates,
                backgroundColor: colors.map(c => c + 'cc'),
                borderColor: colors,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#1f2937', font: { size: 10 }, boxWidth: 10, padding: 8, usePointStyle: true, pointStyle: 'circle' }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw}%`
                    }
                }
            }
        }
    };
}

initApp(() => { renderAllCharts(); });
