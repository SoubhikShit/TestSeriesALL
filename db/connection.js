/**
 * PostgreSQL (Supabase) connection wrapper.
 * Provides a similar API to the old sql.js wrapper:
 *   db.prepare(sql).run/get/all()   — all return Promises
 *   db.exec(sql)                    — returns Promise
 *   db.transaction(fn)              — fn receives txDb; returns async function
 *
 * Automatically converts ? placeholders to $1, $2, ...
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

/** Convert SQLite ? placeholders to PostgreSQL $1, $2, ... */
function convertPlaceholders(sql) {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
}

/** Async Statement wrapper */
class Statement {
    constructor(sql, queryable) {
        this.sql = convertPlaceholders(sql);
        this.queryable = queryable;
    }

    async run(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        let sql = this.sql;
        const isInsert = /^\s*INSERT\s/i.test(sql);
        if (isInsert && !/RETURNING/i.test(sql)) {
            sql = sql.replace(/;?\s*$/, ' RETURNING id');
        }
        const result = await this.queryable.query(sql, flatParams);
        return {
            changes: result.rowCount,
            lastInsertRowid: isInsert && result.rows.length > 0 ? result.rows[0].id : 0
        };
    }

    async get(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const result = await this.queryable.query(this.sql, flatParams);
        return result.rows[0] || undefined;
    }

    async all(...params) {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const result = await this.queryable.query(this.sql, flatParams);
        return result.rows;
    }
}

/** Database wrapper */
const dbWrapper = {
    prepare(sql) {
        return new Statement(sql, pool);
    },
    async exec(sql) {
        await pool.query(sql);
    },
    transaction(fn) {
        return async (...args) => {
            const client = await pool.connect();
            const txDb = {
                prepare(sql) {
                    return new Statement(sql, client);
                },
                async exec(sql) {
                    await client.query(sql);
                },
            };
            try {
                await client.query('BEGIN');
                const result = await fn(txDb, ...args);
                await client.query('COMMIT');
                return result;
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        };
    },
    pragma() { /* no-op for PostgreSQL */ },
    pool,
};

/** Test connection. Called once from init.js */
async function initDB() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL (Supabase) connected');
    } catch (err) {
        console.error('❌ PostgreSQL connection failed:', err.message);
        throw err;
    }
    return dbWrapper;
}

module.exports = dbWrapper;
module.exports.initDB = initDB;
