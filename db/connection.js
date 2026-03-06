/**
 * sql.js wrapper providing a better-sqlite3-compatible API.
 * This avoids the need for native C++ compilation on Windows.
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// On Vercel, use /tmp (only writable dir); locally use the project folder
const isVercel = process.env.VERCEL === '1';
const DB_PATH = isVercel
    ? path.join('/tmp', 'testseries.db')
    : path.resolve(__dirname, '..', process.env.DB_PATH || './db/testseries.db');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// We load sql.js synchronously by caching the initialised DB in a module-level variable.
// The init() bootstrapper in init.js awaits this before the server uses the connection.
let _db = null;
let _SQL = null;
let _inTransaction = false;

/** Persist database to disk */
function saveToDisk() {
    // Don't save mid-transaction — only save after commit
    if (_inTransaction) return;
    if (_db) {
        const data = _db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

/** Statement wrapper — mimics better-sqlite3 Statement */
class Statement {
    constructor(db, sql, saveFn) {
        this.db = db;
        this.sql = sql;
        this.saveFn = saveFn;
    }

    run(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        if (flatParams.length > 0) {
            this.db.run(this.sql, flatParams);
        } else {
            this.db.run(this.sql);
        }
        const changes = this.db.getRowsModified();
        // For INSERT, get last inserted rowid
        const lastRow = this.db.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = lastRow.length > 0 ? lastRow[0].values[0][0] : 0;
        this.saveFn();
        return { changes, lastInsertRowid };
    }

    get(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const stmt = this.db.prepare(this.sql);
        if (flatParams.length > 0) {
            stmt.bind(flatParams);
        }
        if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            return row;
        }
        stmt.free();
        return undefined;
    }

    all(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const results = [];
        const stmt = this.db.prepare(this.sql);
        if (flatParams.length > 0) {
            stmt.bind(flatParams);
        }
        while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            results.push(row);
        }
        stmt.free();
        return results;
    }
}

/** Database wrapper — mimics better-sqlite3 Database */
const dbWrapper = {
    prepare(sql) {
        return new Statement(_db, sql, saveToDisk);
    },
    exec(sql) {
        _db.exec(sql);
        saveToDisk();
    },
    pragma(str) {
        // e.g. "foreign_keys = ON" or "journal_mode = WAL"
        try {
            _db.run(`PRAGMA ${str}`);
        } catch (e) {
            // some pragmas not supported in sql.js — ignore safely
        }
    },
    transaction(fn) {
        return (...args) => {
            _inTransaction = true;
            _db.exec('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                _db.exec('COMMIT');
                _inTransaction = false;
                saveToDisk();
                return result;
            } catch (err) {
                try { _db.exec('ROLLBACK'); } catch(e) { /* already rolled back */ }
                _inTransaction = false;
                throw err;
            }
        };
    }
};

/** Initialise sql.js and return the wrapper. Called once from init.js */
async function initDB() {
    if (_db) return dbWrapper;
    _SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        _db = new _SQL.Database(fileBuffer);
    } else {
        _db = new _SQL.Database();
    }
    // Enable foreign keys
    _db.run('PRAGMA foreign_keys = ON');
    return dbWrapper;
}

// For synchronous require() in route files — they will get the wrapper object.
// init.js must be awaited FIRST before any route uses this.
module.exports = dbWrapper;
module.exports.initDB = initDB;
