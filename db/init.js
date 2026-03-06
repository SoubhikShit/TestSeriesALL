const fs = require('fs');
const path = require('path');
const { initDB } = require('./connection');

async function initialize() {
    const db = await initDB();
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.exec(schema);
    console.log('✅ Database schema initialized');
    return db;
}

module.exports = initialize;
