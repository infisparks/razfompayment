require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const firebaseService = require('./services/firebaseService');
const evolutionWhatsappService = require('./services/evolutionWhatsappService');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_secret';

// Enable CORS
app.use(cors());

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to capture the raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Page routes serving single unified index.html
app.get(['/', '/valdho', '/valdho_first_option_agency', '/valdho_first_option_agency.html', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// -------------------------------------------------------------
// HARDCODED MESSAGE TEMPLATES & 5m INTERVAL CONFIGURATION
// -------------------------------------------------------------
const INTERVAL_MINUTES = 5;

const HARDCODED_HALF_FORM_TEMPLATE = `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`;

const HARDCODED_FULL_FORM_TEMPLATE = `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`;

// Helper: Schedule WhatsApp message for 5 minutes in future
function scheduleMessage({ email, phone, lead_name, form_type, message_text, interval }) {
  let targetDate = new Date();
  targetDate.setMinutes(targetDate.getMinutes() + (INTERVAL_MINUTES || 5));
  const targetDateStr = targetDate.toISOString();

  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO whatsapp_schedules (email, phone, lead_name, form_type, message_text, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    db.run(query, [email, phone, lead_name, form_type, message_text, targetDateStr], function (err) {
      if (err) {
        console.error('[Valdho Scheduler] Error saving schedule:', err.message);
        return reject(err);
      }

      const scheduleRecord = {
        id: this.lastID,
        email,
        phone,
        lead_name,
        form_type,
        message_text,
        scheduled_at: targetDateStr,
        status: 'pending',
        created_at: new Date().toISOString()
      };

      firebaseService.saveValdhoSchedule(scheduleRecord).catch(e => console.error(e));
      console.log(`[Valdho Scheduler] Scheduled ID ${scheduleRecord.id} for ${phone} at ${targetDateStr}`);
      resolve(scheduleRecord);
    });
  });
}

// Helper: Cancel pending schedules for an email
function cancelSchedulesForEmail(email) {
  if (!email) return Promise.resolve();
  return new Promise((resolve) => {
    db.all(`SELECT id FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?) AND status = 'pending'`, [email], async (err, rows) => {
      if (rows && rows.length > 0) {
        for (const r of rows) {
          db.run(`DELETE FROM whatsapp_schedules WHERE id = ?`, [r.id]);
          firebaseService.deleteValdhoSchedule(r.id).catch(e => console.error(e));
        }
      }
      resolve();
    });
  });
}

// -------------------------------------------------------------
// WEBHOOK ENDPOINT FOR VALDHO APPOINTMENTS (/valdho/webhook)
// -------------------------------------------------------------
app.post('/valdho/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[Valdho Webhook Received]:', JSON.stringify(payload));

    const formData = payload.form_data || payload;

    // Extract Email (Searches for any key containing 'email')
    let email = null;
    Object.keys(formData).forEach(k => {
      if (k.toLowerCase().includes('email') && typeof formData[k] === 'string' && formData[k].includes('@')) {
        email = formData[k].trim();
      }
    });

    if (!email) {
      Object.keys(payload).forEach(k => {
        if (k.toLowerCase().includes('email') && typeof payload[k] === 'string' && payload[k].includes('@')) {
          email = payload[k].trim();
        }
      });
    }

    if (!email) {
      console.warn('[Valdho Webhook Warning] Received payload without email identifier');
      return res.status(400).json({ status: 'error', error: 'Missing email in payload' });
    }

    // Extract Name & Phone
    const name = formData['First Name'] || formData.name || formData.first_name || payload['First Name'] || payload.name || 'Valdho Lead';
    const phone = formData['Phone Number'] || formData.phone || formData.mobile || payload['Phone Number'] || payload.phone || 'N/A';

    const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const formDataKeys = Object.keys(formData);
    const hasMultipleChoices = formDataKeys.some(k => Array.isArray(formData[k]) || k.includes('multiple-choice'));

    let isCompleted = false;
    let step1Data = {};
    let step2Data = {};

    if (hasMultipleChoices || !formDataKeys.includes('First Name')) {
      isCompleted = true;
      step2Data = formData;
    } else {
      step1Data = formData;
    }

    // Save to SQLite
    const statusStr = isCompleted ? 'completed' : 'step1_received';
    const existing = await new Promise((res) => {
      db.get('SELECT * FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [email], (err, row) => res(row));
    });

    let mergedStep1 = step1Data;
    let mergedStep2 = step2Data;
    let mergedAll = payload;

    if (existing) {
      try { if (existing.step1_data) mergedStep1 = { ...JSON.parse(existing.step1_data), ...step1Data }; } catch (e) {}
      try { if (existing.step2_data) mergedStep2 = { ...JSON.parse(existing.step2_data), ...step2Data }; } catch (e) {}
      try { if (existing.all_form_data) mergedAll = { ...JSON.parse(existing.all_form_data), ...payload }; } catch (e) {}
    }

    // Extract REAL Name & Phone by checking current payload, mergedStep1, mergedAll, AND existing record!
    const finalName = formData['First Name'] || formData.name || formData.first_name || payload['First Name'] || payload.name
      || mergedStep1['First Name'] || mergedStep1.name || mergedStep1.first_name
      || (existing && existing.name && existing.name !== 'Valdho Lead' ? existing.name : null)
      || 'Valdho Lead';

    const finalPhone = formData['Phone Number'] || formData.phone || formData.mobile || payload['Phone Number'] || payload.phone
      || mergedStep1['Phone Number'] || mergedStep1.phone || mergedStep1.mobile
      || (existing && existing.phone && existing.phone !== 'N/A' ? existing.phone : null)
      || 'N/A';

    const finalStatus = (existing && existing.status === 'completed') || isCompleted ? 'completed' : 'step1_received';

    const insertQuery = `
      INSERT INTO valdho_appointments (email, name, phone, status, step1_data, step2_data, all_form_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET
        name = CASE WHEN excluded.name != 'Valdho Lead' THEN excluded.name ELSE valdho_appointments.name END,
        phone = CASE WHEN excluded.phone != 'N/A' THEN excluded.phone ELSE valdho_appointments.phone END,
        status = excluded.status,
        step1_data = excluded.step1_data,
        step2_data = excluded.step2_data,
        all_form_data = excluded.all_form_data,
        updated_at = CURRENT_TIMESTAMP
    `;

    await new Promise((resolve, reject) => {
      db.run(insertQuery, [
        email, finalName, finalPhone, finalStatus,
        JSON.stringify(mergedStep1), JSON.stringify(mergedStep2), JSON.stringify(mergedAll)
      ], function(err) {
        if (err) reject(err); else resolve();
      });
    });

    // Save to Firebase under /firstoption_agency/{email_key}
    const fbRecord = {
      email,
      name: finalName,
      phone: finalPhone,
      company: 'firstoption_agency',
      status: finalStatus,
      step1_data: mergedStep1,
      step2_data: mergedStep2,
      all_form_data: mergedAll,
      updated_at: new Date().toISOString()
    };

    firebaseService.saveValdhoAppointment(emailKey, fbRecord).catch(e => console.error(e));

    // Auto-Schedule 5-minute WhatsApp message
    if (finalStatus === 'completed') {
      console.log(`[Auto Scheduler] Lead ${email} completed Step 2 (Full Form). Canceling all Step 1 Half Form reminders!`);
      await cancelSchedulesForEmail(email);

      const choices = [];
      Object.keys(mergedAll).forEach(k => { if (Array.isArray(mergedAll[k])) choices.push(...mergedAll[k]); });
      const msgText = HARDCODED_FULL_FORM_TEMPLATE.replace(/\{name\}/g, finalName).replace(/\{answers\}/g, choices.join(', ') || 'Step 2 Completed');

      await scheduleMessage({ email, phone: finalPhone, lead_name: finalName, form_type: 'full_form', message_text: msgText });
    } else {
      const msgText = HARDCODED_HALF_FORM_TEMPLATE.replace(/\{name\}/g, finalName);
      await scheduleMessage({ email, phone: finalPhone, lead_name: finalName, form_type: 'half_form', message_text: msgText });
    }

    res.json({ status: 'ok', message: 'Webhook processed & 5m sequence scheduled successfully', email, form_type: finalStatus });
  } catch (err) {
    console.error('[Valdho Webhook Error]:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// -------------------------------------------------------------
// BACKGROUND DISPATCH TICKER (CONTINUOUS 5m REPEAT SEQUENCE)
// -------------------------------------------------------------
async function checkAndDispatchDueMessages() {
  const nowIso = new Date().toISOString();

  db.all(
    `SELECT * FROM whatsapp_schedules WHERE status = 'pending' AND datetime(scheduled_at) <= datetime(?)`,
    [nowIso],
    async (err, rows) => {
      let dueList = rows || [];
      if (dueList && dueList.length > 0) {
        console.log(`[Valdho Dispatcher] Found ${dueList.length} due message(s).`);
        for (const item of dueList) {
          // Safety Check: If this is a Half Form message, verify lead hasn't completed Step 2 in the meantime
          if (item.form_type === 'half_form' && item.email) {
            const leadRow = await new Promise((res) => {
              db.get('SELECT status, step2_data FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [item.email], (e, r) => res(r));
            });

            let hasStep2 = false;
            if (leadRow) {
              try {
                const s2 = typeof leadRow.step2_data === 'string' ? JSON.parse(leadRow.step2_data) : (leadRow.step2_data || {});
                if (Object.keys(s2).length > 0) hasStep2 = true;
              } catch(e){}
              if (leadRow.status === 'completed') hasStep2 = true;
            }

            if (hasStep2) {
              console.log(`[Scheduler Safety] Lead ${item.email} completed Full Form! Deleting Half Form schedule ID ${item.id}.`);
              db.run(`DELETE FROM whatsapp_schedules WHERE id = ?`, [item.id]);
              firebaseService.deleteValdhoSchedule(item.id).catch(e => console.error(e));
              continue;
            }
          }

          // Dispatch message via Evolution API
          console.log(`[Valdho Dispatcher] Dispatching message ID ${item.id} to ${item.phone}...`);
          const result = await evolutionWhatsappService.sendEvolutionWhatsApp(item.phone, item.message_text);

          const status = result.success ? 'sent' : 'failed';
          const sent_at = result.success ? new Date().toISOString() : null;

          // Mark schedule status
          db.run(`UPDATE whatsapp_schedules SET status = ?, sent_at = ? WHERE id = ?`, [status, sent_at, item.id]);

          // Save message log
          const logData = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            recipient: item.phone,
            payment_id: item.email,
            status: status,
            sent_at: sent_at || new Date().toISOString()
          };
          firebaseService.saveWhatsAppLog(logData).catch(e => console.error(e));

          // Continuous Repeat Sequence: Auto-schedule next 5m message!
          if (result.success && item.email) {
            console.log(`[Valdho Dispatcher] Auto-scheduling next 5m repeat message for ${item.email}...`);
            scheduleMessage({
              email: item.email,
              phone: item.phone,
              lead_name: item.lead_name,
              form_type: item.form_type,
              message_text: item.message_text
            }).catch(e => console.error('[Valdho Dispatcher Error]:', e));
          }
        }
      }
    }
  );
}

// Run background dispatcher every 5 seconds
setInterval(checkAndDispatchDueMessages, 5000);

// -------------------------------------------------------------
// API ENDPOINTS FOR FRONTEND DASHBOARD
// -------------------------------------------------------------
app.get('/api/valdho/appointments', (req, res) => {
  db.all(`SELECT * FROM valdho_appointments ORDER BY updated_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.delete('/api/valdho/appointments/:email', async (req, res) => {
  const email = req.params.email;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  db.run(`DELETE FROM valdho_appointments WHERE LOWER(email) = LOWER(?)`, [email]);
  cancelSchedulesForEmail(email);
  firebaseService.deleteValdhoAppointment(email).catch(e => console.error(e));

  res.json({ status: 'ok', message: `Appointment and pending schedules for ${email} deleted successfully` });
});

app.get('/api/valdho/whatsapp/schedules', (req, res) => {
  db.all(`SELECT * FROM whatsapp_schedules WHERE status = 'pending' ORDER BY datetime(scheduled_at) ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.delete('/api/valdho/whatsapp/schedules/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM whatsapp_schedules WHERE id = ?`, [id]);
  firebaseService.deleteValdhoSchedule(id).catch(e => console.error(e));
  res.json({ status: 'ok', message: `Schedule #${id} deleted` });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Server running on port ${PORT}`);
  console.log(` Dashboard URL: http://localhost:${PORT}`);
  console.log(` Webhook URL: http://localhost:${PORT}/valdho/webhook`);
  console.log(`=======================================================`);
});
