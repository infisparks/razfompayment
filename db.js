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
            
            // Create valdho_appointments table if it doesn't exist
            db.run(`
              CREATE TABLE IF NOT EXISTS valdho_appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                name TEXT,
                phone TEXT,
                step1_data TEXT,
                step2_data TEXT,
                all_form_data TEXT,
                status TEXT DEFAULT 'step1_received',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `, (valdhoTableErr) => {
              if (valdhoTableErr) {
                console.error('Error creating valdho_appointments table:', valdhoTableErr.message);
              } else {
                console.log('valdho_appointments table ready.');

                // Create whatsapp_schedules table if it doesn't exist
                db.run(`
                  CREATE TABLE IF NOT EXISTS whatsapp_schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT,
                    phone TEXT,
                    lead_name TEXT,
                    form_type TEXT,
                    message_text TEXT,
                    scheduled_at DATETIME,
                    status TEXT DEFAULT 'pending',
                    error_message TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    sent_at DATETIME
                  )
                `, (schedTableErr) => {
                  if (schedTableErr) {
                    console.error('Error creating whatsapp_schedules table:', schedTableErr.message);
                  } else {
                    console.log('whatsapp_schedules table ready.');
                  }
                });
              }
            });
          }
        });
      }
    });
  }
});

module.exports = db;
