const fs = require('fs');
const path = require('path');
const { initDB } = require('./connection');

async function initialize() {
    const db = await initDB();
    // Read and execute the full schema (sql.js exec handles multi-statement SQL)
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    console.log('✅ Database initialized successfully');
    return db;
}

module.exports = initialize;
