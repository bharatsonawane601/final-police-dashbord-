const express = require('express');
const compression = require('compression');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const db = require('./database');
const excelSync = require('./excelSync');
const auth = require('./auth');
const { requireAuth, requireRole, requireAdmin } = require('./authMiddleware');

const app = express();
const PORT = 5000;

// ═══════════════════════════════════════════════════════════════
//  Security Middleware
// ═══════════════════════════════════════════════════════════════

// Gzip/Brotli compression — reduces transfer sizes by 70-80%
app.use(compression({ level: 6, threshold: 512 }));

// Helmet — secure HTTP headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// CORS — restrict to same origin
app.use(cors({ origin: true, credentials: true }));

// Cookie parser
app.use(cookieParser());

// General rate limiter — 500 requests per 15 min per IP
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    // Exempt logout so it always works
    skip: (req) => req.path === '/api/logout'
});
app.use('/api/', generalLimiter);

// Login rate limiter — 5 attempts per 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Multer for file uploads
const upload = multer({
    dest: path.join(__dirname, 'data', 'uploads'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only .xlsx and .xls files are allowed'));
        }
    }
});

// Path to the Excel file (default — can be changed via settings)
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');
let EXCEL_PATH = null; // No default — user connects via Data page

// Load saved settings
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            if (settings.excelPath && fs.existsSync(settings.excelPath)) {
                EXCEL_PATH = settings.excelPath;
            }
        }
    } catch (e) {
        console.log('  [Settings] Using default Excel path');
    }
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ excelPath: EXCEL_PATH }, null, 2));
}

// SSE clients
let sseClients = [];

// In-memory API data cache — avoids recomputing for every client
let dataCache = { data: null, ts: 0 };

// ═══════════════════════════════════════════════════════════════
//  Initialize
// ═══════════════════════════════════════════════════════════════
loadSettings();
db.initDB();
auth.initAuthDB(db.getDB());

if (EXCEL_PATH) {
    const count = db.getRecordCount();
    if (count === 0) {
        console.log('  [Startup] Saved data source found — loading...');
        excelSync.loadExcelIntoDB(EXCEL_PATH);
    } else {
        console.log(`  [Startup] Database has ${count} records — ready`);
    }
} else {
    console.log('  [Startup] No data source connected — go to Data page to connect');
}

// ═══════════════════════════════════════════════════════════════
//  Static Files & Auth Redirect
// ═══════════════════════════════════════════════════════════════

// Serve login page without auth
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

// Serve static assets (CSS, JS, images, fonts, libs) without auth
// Cache for 24h — browser reuses from disk cache on tab switches
const staticOpts = { maxAge: '0', etag: true, lastModified: true };
app.use('/css', express.static(path.join(__dirname, '..', 'frontend', 'css'), staticOpts));
app.use('/js', express.static(path.join(__dirname, '..', 'frontend', 'js'), staticOpts));
app.use('/img', express.static(path.join(__dirname, '..', 'frontend', 'img'), staticOpts));
app.use('/fonts', express.static(path.join(__dirname, '..', 'frontend', 'fonts'), staticOpts));
app.use('/libs', express.static(path.join(__dirname, '..', 'frontend', 'libs'), staticOpts));

// Protected HTML pages — require auth, redirect to login if not authenticated
app.get('/', (req, res, next) => {
    requireAuth(req, res, () => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    });
});

app.get('/index.html', (req, res, next) => {
    requireAuth(req, res, () => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    });
});

app.get('/station.html', (req, res, next) => {
    requireAuth(req, res, () => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'station.html'));
    });
});

app.get('/data.html', (req, res, next) => {
    requireAuth(req, res, () => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'data.html'));
    });
});

app.get('/admin.html', (req, res, next) => {
    requireAuth(req, res, () => {
        if (req.user.role !== 'admin') return res.redirect('/');
        res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'));
    });
});

// ═══════════════════════════════════════════════════════════════
//  KeyAuth Configuration & Startup Validation
// ═══════════════════════════════════════════════════════════════
const KEYAUTH_CONFIG = {
    name: "Bharatsonawane260's Application",
    ownerid: 'Yi3JM6OEsn',
    secret: '7d2ed0edcd2dd5b84f15d7600d49b26c4535274b225fc871d67411b9a7f46f5c',
    version: '1.0',
    apiUrl: 'https://keyauth.win/api/1.2/',
    licenseKey: 'KEYAUTH-zATYIm-D3edAm-57gSTs-jmnqDp-4DMlr1-TY9QHQ',
    hwid: 'zone1-crime-intelligence-server-001'
};

// Cache: validated once at startup, re-checked every 1 hour
let keyAuthValid = false;
let keyAuthLastCheck = 0;
const KEYAUTH_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Validate the application license with KeyAuth.
 * Uses init to confirm app exists + license check with HWID.
 */
async function validateKeyAuth() {
    try {
        // Init session
        const initRes = await fetch(KEYAUTH_CONFIG.apiUrl, {
            method: 'POST',
            body: new URLSearchParams({
                type: 'init',
                ver: KEYAUTH_CONFIG.version,
                name: KEYAUTH_CONFIG.name,
                ownerid: KEYAUTH_CONFIG.ownerid
            }),
            signal: AbortSignal.timeout(10000)
        });
        const initData = await initRes.json();

        if (!initData.success) {
            console.error('  [KeyAuth] Init failed:', initData.message);
            return false;
        }

        // Validate license key
        const licRes = await fetch(KEYAUTH_CONFIG.apiUrl, {
            method: 'POST',
            body: new URLSearchParams({
                type: 'license',
                key: KEYAUTH_CONFIG.licenseKey,
                sessionid: initData.sessionid,
                name: KEYAUTH_CONFIG.name,
                ownerid: KEYAUTH_CONFIG.ownerid,
                hwid: KEYAUTH_CONFIG.hwid
            }),
            signal: AbortSignal.timeout(10000)
        });
        const licData = await licRes.json();

        // "Logged in!" means the key was already registered and is still valid
        // "success":true means first-time registration succeeded
        if (licData.success) {
            console.log('  [KeyAuth] ✓ License valid');
            return true;
        }

        // "already been used" with same HWID = already registered = VALID
        // KeyAuth returns this when the key is bound to this HWID already
        const msg = (licData.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('logged in')) {
            console.log('  [KeyAuth] ✓ License already registered (valid)');
            return true;
        }

        console.error('  [KeyAuth] ✗ License invalid:', licData.message);
        return false;
    } catch (err) {
        console.error('  [KeyAuth] Error:', err.message);
        return false;
    }
}

// Run initial validation at startup
(async () => {
    keyAuthValid = await validateKeyAuth();
    keyAuthLastCheck = Date.now();
    if (!keyAuthValid) {
        console.error('  [KeyAuth] ⚠ WARNING: License validation failed. Login will be blocked.');
    }
})();

// ═══════════════════════════════════════════════════════════════
//  Auth Routes (Public)
// ═══════════════════════════════════════════════════════════════

// Login (with background KeyAuth license validation)
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Re-check KeyAuth if cache expired (every 1 hour)
        if (Date.now() - keyAuthLastCheck > KEYAUTH_CHECK_INTERVAL) {
            keyAuthValid = await validateKeyAuth();
            keyAuthLastCheck = Date.now();
        }

        if (!keyAuthValid) {
            return res.status(403).json({ error: 'Application license expired or invalid. Contact administrator.' });
        }

        // Step 2: Authenticate username/password locally
        const cleanUsername = String(username).trim().toLowerCase().slice(0, 50);
        const cleanPassword = String(password).slice(0, 128);

        const user = auth.authenticateUser(cleanUsername, cleanPassword);
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = auth.generateToken(user);

        // Set HttpOnly cookie
        res.cookie('z1cis_token', token, {
            httpOnly: true,
            secure: false, // set to true in production with HTTPS
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000, // 8 hours
            path: '/'
        });

        res.json({
            success: true,
            user: { username: user.username, role: user.role }
        });
    } catch (err) {
        console.error('  [Login] Error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('z1cis_token', { path: '/' });
    res.json({ success: true });
});

// Current user info
app.get('/api/me', requireAuth, (req, res) => {
    res.json({
        username: req.user.username,
        role: req.user.role
    });
});

// ═══════════════════════════════════════════════════════════════
//  Admin API — User Management (Admin Only)
// ═══════════════════════════════════════════════════════════════

// List all users
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
    try {
        const users = auth.getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new user
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
    try {
        const { username, password, role } = req.body;
        const user = auth.createUser(
            String(username || '').trim().toLowerCase(),
            String(password || ''),
            String(role || '').toLowerCase()
        );
        res.status(201).json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update user role
app.put('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { role } = req.body;
        const user = auth.updateUserRole(userId, String(role || '').toLowerCase());
        res.json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete user
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        auth.deleteUser(userId);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  Data API — Read (Any Authenticated User)
// ═══════════════════════════════════════════════════════════════

// Get Data Summary (for dashboards)
app.get('/api/data', requireAuth, (req, res) => {
    try {
        // Serve from cache if fresh (5s TTL) — avoids recomputing for every client
        const now = Date.now();
        if (dataCache.data && (now - dataCache.ts) < 5000) {
            return res.json(dataCache.data);
        }
        const data = db.getDataSummary();
        dataCache = { data, ts: now };
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Paginated Records (for Data page)
app.get('/api/records', requireAuth, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const filters = {
            year: req.query.year,
            month: req.query.month,
            station: req.query.station,
            crimeType: req.query.crimeType,
            search: req.query.search
        };
        const data = db.getRecordsPaginated(page, limit, filters);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Settings
app.get('/api/settings', requireAuth, (req, res) => {
    res.json({
        excelPath: EXCEL_PATH,
        connected: !!EXCEL_PATH,
        recordCount: db.getRecordCount(),
        dbPath: path.join(__dirname, 'data', 'crime_data.db')
    });
});

// Export as Excel
app.get('/api/export', requireAuth, (req, res) => {
    try {
        const exportPath = path.join(__dirname, 'data', 'export_crime_data.xlsx');
        excelSync.exportToExcel(exportPath);
        res.download(exportPath, 'Crime_Data_Export.xlsx', (err) => {
            // Clean up temp file after download
            if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Filter options
app.get('/api/filter-options', requireAuth, (req, res) => {
    try {
        const data = db.getDataSummary();
        res.json(data.filters);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  Data API — Write (Editor Role Only)
// ═══════════════════════════════════════════════════════════════

// Add Record
app.post('/api/records', requireAuth, requireRole('editor'), (req, res) => {
    try {
        const record = db.addRecord(req.body);
        // Write back to Excel
        excelSync.writeBackToExcel(EXCEL_PATH);
        notifyClients();
        res.status(201).json(record);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Record
app.put('/api/records/:id', requireAuth, requireRole('editor'), (req, res) => {
    try {
        const record = db.updateRecord(parseInt(req.params.id), req.body);
        if (!record) return res.status(404).json({ error: 'Record not found' });
        // Write back to Excel
        excelSync.writeBackToExcel(EXCEL_PATH);
        notifyClients();
        res.json(record);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Record
app.delete('/api/records/:id', requireAuth, requireRole('editor'), (req, res) => {
    try {
        const result = db.deleteRecord(parseInt(req.params.id));
        if (result.changes === 0) return res.status(404).json({ error: 'Record not found' });
        // Write back to Excel
        excelSync.writeBackToExcel(EXCEL_PATH);
        notifyClients();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload & Import Excel
app.post('/api/upload-excel', requireAuth, requireRole('editor'), upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Move uploaded file to data directory
        const destPath = path.join(__dirname, 'data', req.file.originalname);
        fs.renameSync(req.file.path, destPath);

        // Update Excel path
        EXCEL_PATH = destPath;
        saveSettings();

        // Import into SQLite
        const result = excelSync.loadExcelIntoDB(destPath);
        if (result.success) {
            notifyClients();
            res.json({ success: true, count: result.count, path: destPath });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reload from Excel
app.post('/api/reload', requireAuth, requireRole('editor'), (req, res) => {
    try {
        const result = excelSync.loadExcelIntoDB(EXCEL_PATH);
        if (result.success) {
            notifyClients();
            res.json({ success: true, count: result.count });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Connect data source
app.post('/api/connect', requireAuth, requireRole('editor'), (req, res) => {
    try {
        let { filePath } = req.body;
        if (!filePath) return res.status(400).json({ error: 'No file path provided' });

        // Strip surrounding quotes (pasted from file explorer)
        filePath = String(filePath).trim().replace(/^"|"$/g, '');

        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found at that path' });

        EXCEL_PATH = filePath;
        saveSettings();

        const result = excelSync.loadExcelIntoDB(filePath);
        if (result.success) {
            startWatcher();
            notifyClients();
            res.json({ success: true, count: result.count, path: filePath });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Disconnect data source
app.post('/api/disconnect', requireAuth, requireRole('editor'), (req, res) => {
    try {
        EXCEL_PATH = null;
        db.clearAll();
        if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
        if (watcher) { watcher.close(); watcher = null; }
        notifyClients();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  SSE Events (Authenticated)
// ═══════════════════════════════════════════════════════════════
app.get('/api/events', requireAuth, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    res.write('data: {"type":"connected"}\n\n');
    sseClients.push(res);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
    });
});

function notifyClients() {
    // Invalidate API cache on data changes
    dataCache = { data: null, ts: 0 };
    const message = JSON.stringify({ type: 'data-updated', timestamp: new Date().toISOString() });
    sseClients.forEach(client => {
        client.write(`data: ${message}\n\n`);
    });
}

// ═══════════════════════════════════════════════════════════════
//  File Watcher
// ═══════════════════════════════════════════════════════════════
let debounceTimer = null;
let watcher = null;

function startWatcher() {
    if (watcher) watcher.close();
    if (!EXCEL_PATH || !fs.existsSync(EXCEL_PATH)) return;

    watcher = chokidar.watch(EXCEL_PATH, {
        persistent: true,
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 300
        }
    });

    watcher.on('change', () => {
        // Skip if we triggered this change (write-back)
        if (excelSync.getIsSyncing()) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            console.log(`  [Watcher] Excel file changed externally — re-syncing...`);
            excelSync.loadExcelIntoDB(EXCEL_PATH);
            notifyClients();
        }, 500);
    });

    watcher.on('error', (error) => {
        console.error('  [Watcher] Error:', error);
    });
}

if (EXCEL_PATH) startWatcher();

// ═══════════════════════════════════════════════════════════════
//  Error Handler (catches multer and other errors)
// ═══════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
    if (err && err.name === 'MulterError') {
        return res.status(400).json({ error: 'File upload error: ' + err.message });
    }
    if (err) {
        console.error('  [Error]', err.message);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    next();
});

// ═══════════════════════════════════════════════════════════════
//  Start Server
// ═══════════════════════════════════════════════════════════════

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.listen(PORT, '0.0.0.0', () => {
    const recordCount = db.getRecordCount();
    // Get local IP for display
    const os = require('os');
    const nets = os.networkInterfaces();
    let localIP = 'your-pc-ip';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                localIP = net.address;
                break;
            }
        }
        if (localIP !== 'your-pc-ip') break;
    }
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   Zone 1 Crime Intelligence System           ║');
    console.log('  ║   झोन 1 गुन्हे गुप्तचर प्रणाली                  ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║   Local:   http://localhost:${PORT}           ║`);
    console.log(`  ║   Network: http://${localIP}:${PORT}`.padEnd(48) + '║');
    console.log(`  ║   Excel:   ${(EXCEL_PATH ? path.basename(EXCEL_PATH) : 'Not connected').substring(0, 30).padEnd(30)}   ║`);
    console.log(`  ║   Records: ${String(recordCount).padEnd(30)}   ║`);
    console.log('  ║   Database: SQLite (WAL mode)                ║');
    console.log('  ║   Auth:    ✓ JWT + bcrypt + roles            ║');
    console.log('  ║   Security: Helmet, CORS, Rate-limit         ║');
    console.log(`  ║   Status:  ${EXCEL_PATH ? 'Watching for changes...' : 'Waiting for data source...'}   ║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
});

