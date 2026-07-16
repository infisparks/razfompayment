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
        
        // Create whatsapp_logs table if it doesn't exist
        db.run(`
          CREATE TABLE IF NOT EXISTS whatsapp_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            recipient TEXT,
            payment_id TEXT,
            status TEXT,
            conversation_id TEXT,
            pricing_category TEXT,
            billable INTEGER,
            error_code INTEGER,
            error_title TEXT,
            error_message TEXT,
            raw_payload TEXT,
            received_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (logTableErr) => {
          if (logTableErr) {
            console.error('Error creating whatsapp_logs table:', logTableErr.message);
          } else {
            console.log('whatsapp_logs table ready.');
          }
        });
      }
    });
  }
});

module.exports = db;
