const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'payments.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to the SQLite database:', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    
    // Create payments table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT UNIQUE,
        amount INTEGER,
        currency TEXT,
        status TEXT,
        method TEXT,
        email TEXT,
        phone TEXT,
        company_name TEXT,
        created_at INTEGER,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        raw_payload TEXT
      )
    `, (tableErr) => {
      if (tableErr) {
        console.error('Error creating payments table:', tableErr.message);
      } else {
        console.log('Payments table ready.');
      }
    });
  }
});

module.exports = db;
