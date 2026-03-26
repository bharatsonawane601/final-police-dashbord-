const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('./database');

// Track sync state to prevent loops
let isSyncing = false;

// ─── Load Excel into SQLite ──────────────────────────────────
function loadExcelIntoDB(excelPath) {
    if (!fs.existsSync(excelPath)) {
        console.error(`  [Sync] Excel file not found: ${excelPath}`);
        return { success: false, error: 'File not found' };
    }

    isSyncing = true;
    try {
        const workbook = XLSX.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet);

        // Clear existing data
        db.clearAll();

        // Bulk insert using a transaction for speed
        const database = db.getDB();
        const insertStmt = database.prepare(`
            INSERT INTO crime_records (year, month, police_station, crime_type, under_investigation, closed)
            VALUES (@year, @month, @police_station, @crime_type, @under_investigation, @closed)
        `);

        const insertMany = database.transaction((rows) => {
            for (const row of rows) {
                // Normalize keys by trimming whitespace
                const r = {};
                for (const key in row) r[key.trim()] = row[key];

                insertStmt.run({
                    year: parseInt(r['Year'] || r['year'] || r['वर्षे'] || r['वर्ष'] || 0) || 0,
                    month: parseInt(r['Month'] || r['month'] || r['महिना'] || 0) || 0,
                    police_station: r['Police Station'] || r['police station'] || r['पोलीस स्टेशन नांव'] || r['पोलीस स्टेशन'] || '',
                    crime_type: r['Crime Type'] || r['crime type'] || r['गुन्हयाचा प्रकार  हेड (वर्गवारी)'] || r['गुन्हयाचा प्रकार हेड (वर्गवारी)'] || r['गुन्हयाचा प्रकार'] || '',
                    under_investigation: parseInt(r['Registered Offence'] || r['registered offence'] || r['Ragisterd Offence'] || r['ragisterd offence'] || r['Under Investigation'] || r['under investigation'] || r['दाखल'] || 0) || 0,
                    closed: parseInt(r['Detected'] || r['detected'] || r['Closed'] || r['closed'] || r['उघड'] || 0) || 0
                });
            }
        });

        insertMany(rawData);

        const count = db.getRecordCount();
        console.log(`  [Sync] Loaded ${count} records from Excel into SQLite`);
        return { success: true, count };
    } catch (err) {
        console.error('  [Sync] Error loading Excel:', err.message);
        return { success: false, error: err.message };
    } finally {
        isSyncing = false;
    }
}

// ─── Write SQLite data back to Excel ─────────────────────────
function writeBackToExcel(excelPath) {
    if (isSyncing) return; // prevent sync loops
    isSyncing = true;

    try {
        const records = db.getAllRecords();

        // Convert to Excel-friendly format (matching original column names)
        const excelData = records.map(r => ({
            'Year': r.year,
            'Month': r.month,
            'Police Station': r.police_station,
            'Crime Type': r.crime_type,
            'Registered Offence': r.under_investigation,
            'Detected': r.closed
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Crime Data');

        // Set column widths for readability
        worksheet['!cols'] = [
            { wch: 6 },   // Year
            { wch: 6 },   // Month
            { wch: 20 },  // Police Station
            { wch: 25 },  // Crime Type
            { wch: 20 },  // Registered Offence
            { wch: 10 }   // Detected
        ];

        XLSX.writeFile(workbook, excelPath);
        console.log(`  [Sync] Wrote ${records.length} records back to Excel`);
        return { success: true, count: records.length };
    } catch (err) {
        console.error('  [Sync] Error writing to Excel:', err.message);
        return { success: false, error: err.message };
    } finally {
        // Delay resetting flag to let file watcher debounce
        setTimeout(() => { isSyncing = false; }, 2000);
    }
}

// ─── Export to a new Excel file (download) ───────────────────
function exportToExcel(outputPath) {
    return writeBackToExcel(outputPath);
}

// ─── Check if currently syncing (to prevent watcher loops) ───
function getIsSyncing() {
    return isSyncing;
}

module.exports = {
    loadExcelIntoDB,
    writeBackToExcel,
    exportToExcel,
    getIsSyncing
};
