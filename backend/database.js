const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'crime_data.db');

let db = null;

// ─── Initialize Database ─────────────────────────────────────
function initDB() {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    db = new Database(DB_PATH);

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');

    // Create table if not exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS crime_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            police_station TEXT NOT NULL,
            crime_type TEXT NOT NULL,
            under_investigation INTEGER DEFAULT 0,
            closed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_station ON crime_records(police_station);
        CREATE INDEX IF NOT EXISTS idx_year ON crime_records(year);
        CREATE INDEX IF NOT EXISTS idx_crime_type ON crime_records(crime_type);
    `);

    console.log('  [DB] SQLite database initialized');
    return db;
}

// ─── CRUD Operations ─────────────────────────────────────────

function getAllRecords() {
    return db.prepare('SELECT * FROM crime_records ORDER BY year DESC, month DESC').all();
}

function getRecordsPaginated(page = 1, limit = 50, filters = {}) {
    let where = [];
    let params = {};

    if (filters.year) {
        where.push('year = @year');
        params.year = parseInt(filters.year);
    }
    if (filters.month) {
        where.push('month = @month');
        params.month = parseInt(filters.month);
    }
    if (filters.station) {
        where.push('police_station = @station');
        params.station = filters.station;
    }
    if (filters.crimeType) {
        where.push('crime_type = @crimeType');
        params.crimeType = filters.crimeType;
    }
    if (filters.search) {
        where.push('(police_station LIKE @search OR crime_type LIKE @search)');
        params.search = `%${filters.search}%`;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (page - 1) * limit;

    const records = db.prepare(
        `SELECT * FROM crime_records ${whereClause} ORDER BY year DESC, month DESC, id DESC LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset });

    const totalRow = db.prepare(
        `SELECT COUNT(*) as total FROM crime_records ${whereClause}`
    ).get(params);

    return {
        records,
        total: totalRow.total,
        page,
        limit,
        totalPages: Math.ceil(totalRow.total / limit)
    };
}

function getRecordById(id) {
    return db.prepare('SELECT * FROM crime_records WHERE id = ?').get(id);
}

function addRecord(record) {
    const stmt = db.prepare(`
        INSERT INTO crime_records (year, month, police_station, crime_type, under_investigation, closed)
        VALUES (@year, @month, @police_station, @crime_type, @under_investigation, @closed)
    `);
    const result = stmt.run({
        year: parseInt(record.year),
        month: parseInt(record.month),
        police_station: record.police_station || record.policeStation,
        crime_type: record.crime_type || record.crimeType,
        under_investigation: parseInt(record.under_investigation || record.underInvestigation || 0),
        closed: parseInt(record.closed || 0)
    });
    return { id: result.lastInsertRowid, ...record };
}

function updateRecord(id, updates) {
    const fields = [];
    const params = { id };

    if (updates.year !== undefined) { fields.push('year = @year'); params.year = parseInt(updates.year); }
    if (updates.month !== undefined) { fields.push('month = @month'); params.month = parseInt(updates.month); }
    if (updates.police_station !== undefined) { fields.push('police_station = @police_station'); params.police_station = updates.police_station; }
    if (updates.crime_type !== undefined) { fields.push('crime_type = @crime_type'); params.crime_type = updates.crime_type; }
    if (updates.under_investigation !== undefined) { fields.push('under_investigation = @under_investigation'); params.under_investigation = parseInt(updates.under_investigation); }
    if (updates.closed !== undefined) { fields.push('closed = @closed'); params.closed = parseInt(updates.closed); }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    if (fields.length === 1) return getRecordById(id); // nothing to update

    db.prepare(`UPDATE crime_records SET ${fields.join(', ')} WHERE id = @id`).run(params);
    return getRecordById(id);
}

function deleteRecord(id) {
    return db.prepare('DELETE FROM crime_records WHERE id = ?').run(id);
}

function clearAll() {
    db.prepare('DELETE FROM crime_records').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name='crime_records'").run();
}

// ─── Summary & Filters (matches existing /api/data format) ───
function getDataSummary(filters = {}) {
    let where = [];
    let params = {};

    if (filters.year) { where.push('year = @year'); params.year = parseInt(filters.year); }
    if (filters.month) { where.push('month = @month'); params.month = parseInt(filters.month); }
    if (filters.station) { where.push('police_station = @station'); params.station = filters.station; }
    if (filters.crimeType) { where.push('crime_type = @crimeType'); params.crimeType = filters.crimeType; }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const records = db.prepare(
        `SELECT year, month, police_station as policeStation, crime_type as crimeType, under_investigation as underInvestigation, closed FROM crime_records ${whereClause} ORDER BY year, month`
    ).all(params);

    const totalCrimes = records.reduce((s, r) => s + r.underInvestigation, 0);
    const totalClosed = records.reduce((s, r) => s + r.closed, 0);
    const totalUnsolved = Math.max(0, totalCrimes - totalClosed);
    
    let closureRateRaw = totalCrimes > 0 ? (totalClosed / totalCrimes) * 100 : 0;
    if (closureRateRaw > 100) closureRateRaw = 100; // Cap at 100%
    const closureRate = closureRateRaw.toFixed(1);

    const years = [...new Set(records.map(r => r.year))].sort();
    const months = [...new Set(records.map(r => r.month))].sort((a, b) => a - b);
    const stations = [...new Set(records.map(r => r.policeStation))].sort();
    const crimeTypes = [...new Set(records.map(r => r.crimeType))].sort();

    return {
        records,
        summary: {
            totalCrimes,
            totalUnsolved,
            totalClosed,
            closureRate: parseFloat(closureRate)
        },
        filters: { years, months, stations, crimeTypes },
        lastModified: new Date().toISOString()
    };
}

function getRecordCount() {
    return db.prepare('SELECT COUNT(*) as count FROM crime_records').get().count;
}

function getDB() { return db; }

module.exports = {
    initDB,
    getDB,
    getAllRecords,
    getRecordsPaginated,
    getRecordById,
    addRecord,
    updateRecord,
    deleteRecord,
    clearAll,
    getDataSummary,
    getRecordCount
};
