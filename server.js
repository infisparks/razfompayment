require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const firebaseService = require('./services/firebaseService');
const evolutionWhatsappService = require('./services/evolutionWhatsappService');
const metaCapiService = require('./services/metaCapiService');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// JSON Middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Serve single canonical template public/index.html for ALL page routes
app.get(['/', '/valdho', '/valdho_first_option_agency', '/valdho_first_option_agency.html', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// -------------------------------------------------------------
// HARDCODED MESSAGE TEMPLATES & TIMING CONFIGURATION
// -------------------------------------------------------------
const META_DELAY_MINUTES = 5; // Wait 5m after Step 1 before Meta retargeting event
const WHATSAPP_REPEAT_MINUTES = 1; // Repeat WhatsApp messages every 1m

const HARDCODED_HALF_FORM_TEMPLATE = `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`;

const HARDCODED_FULL_FORM_TEMPLATE = `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`;

// Helper: Schedule WhatsApp message for specified minutes in future
function scheduleMessage({ email, phone, lead_name, form_type, message_text, delayMinutes }) {
  let targetDate = new Date();
  const minsToAdd = typeof delayMinutes === 'number' ? delayMinutes : (form_type === 'half_form' ? META_DELAY_MINUTES : WHATSAPP_REPEAT_MINUTES);
  targetDate.setMinutes(targetDate.getMinutes() + minsToAdd);
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
      console.log(`[Valdho Scheduler] Scheduled ID ${scheduleRecord.id} for ${phone} at ${targetDateStr} (${minsToAdd}m delay)`);
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

// Helper: Restore and sync appointments and schedules from Firebase into SQLite
async function syncAppointmentsFromFirebase() {
  try {
    const fbList = await firebaseService.getValdhoAppointments();
    if (fbList && fbList.length > 0) {
      for (const item of fbList) {
        if (!item || !item.email) continue;
        const email = item.email;
        const name = item.name || 'Valdho Lead';
        const phone = item.phone || 'N/A';
        const status = item.status || 'step1_received';
        const meta_sent = item.meta_sent ? 1 : 0;
        const step1Str = typeof item.step1_data === 'object' ? JSON.stringify(item.step1_data) : (item.step1_data || '{}');
        const step2Str = typeof item.step2_data === 'object' ? JSON.stringify(item.step2_data) : (item.step2_data || '{}');
        const allDataStr = typeof item.all_form_data === 'object' ? JSON.stringify(item.all_form_data) : (item.all_form_data || '{}');
        const updatedAt = item.updated_at || new Date().toISOString();

        const insertQuery = `
          INSERT INTO valdho_appointments (email, name, phone, status, meta_sent, step1_data, step2_data, all_form_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN excluded.name != 'Valdho Lead' THEN excluded.name ELSE valdho_appointments.name END,
            phone = CASE WHEN excluded.phone != 'N/A' THEN excluded.phone ELSE valdho_appointments.phone END,
            status = excluded.status,
            meta_sent = MAX(valdho_appointments.meta_sent, excluded.meta_sent),
            step1_data = excluded.step1_data,
            step2_data = excluded.step2_data,
            all_form_data = excluded.all_form_data,
            updated_at = excluded.updated_at
        `;

        await new Promise((res) => {
          db.run(insertQuery, [email, name, phone, status, meta_sent, step1Str, step2Str, allDataStr, updatedAt, updatedAt], () => res());
        });
      }
      console.log(`[Firebase Auto Sync] Restored ${fbList.length} appointment(s) from Firebase into SQLite.`);
    }

    // Also restore schedules from Firebase
    const fbSchedules = await firebaseService.getValdhoSchedules();
    if (fbSchedules && fbSchedules.length > 0) {
      for (const sched of fbSchedules) {
        if (!sched || !sched.email || sched.status !== 'pending') continue;
        const checkExisting = await new Promise(res => db.get('SELECT id FROM whatsapp_schedules WHERE id = ?', [sched.id], (e, r) => res(r)));
        if (!checkExisting) {
          db.run(
            `INSERT INTO whatsapp_schedules (id, email, phone, lead_name, form_type, message_text, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [sched.id, sched.email, sched.phone || 'N/A', sched.lead_name || 'Valdho Lead', sched.form_type || 'half_form', sched.message_text || '', sched.scheduled_at || new Date().toISOString()]
          );
        }
      }
    }

    // Auto-Ensure every active appointment has a pending schedule for continuous repeat messages
    db.all(`SELECT * FROM valdho_appointments`, [], async (err, rows) => {
      if (rows && rows.length > 0) {
        for (const appRow of rows) {
          const pending = await new Promise(res => db.get(`SELECT id FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?) AND status = 'pending'`, [appRow.email], (e, r) => res(r)));
          if (!pending) {
            console.log(`[Auto Schedule Guard] Creating missing repeat schedule for lead ${appRow.email}...`);
            const isCompleted = appRow.status === 'completed';
            const msgText = isCompleted
              ? HARDCODED_FULL_FORM_TEMPLATE.replace(/\{name\}/g, appRow.name || 'Valdho Lead').replace(/\{answers\}/g, 'Registration Completed')
              : HARDCODED_HALF_FORM_TEMPLATE.replace(/\{name\}/g, appRow.name || 'Valdho Lead');
            const fType = isCompleted ? 'full_form' : 'half_form';
            const delay = isCompleted ? WHATSAPP_REPEAT_MINUTES : META_DELAY_MINUTES;

            scheduleMessage({
              email: appRow.email,
              phone: appRow.phone || 'N/A',
              lead_name: appRow.name || 'Valdho Lead',
              form_type: fType,
              message_text: msgText,
              delayMinutes: delay
            }).catch(e => console.error(e));
          }
        }
      }
    });

  } catch (err) {
    console.error('[Firebase Auto Sync Error]:', err.message);
  }
}

// Perform initial sync on server boot
syncAppointmentsFromFirebase();

// -------------------------------------------------------------
// WEBHOOK ENDPOINT FOR VALDHO APPOINTMENTS (/valdho/webhook)
// -------------------------------------------------------------
app.post('/valdho/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[Valdho Webhook Received]:', JSON.stringify(payload));

    const formData = payload.form_data || payload;

    // Extract Email
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

    // Existing lead lookup
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
    const metaSentFlag = existing ? (existing.meta_sent ? 1 : 0) : 0;

    const insertQuery = `
      INSERT INTO valdho_appointments (email, name, phone, status, meta_sent, step1_data, step2_data, all_form_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
        email, finalName, finalPhone, finalStatus, metaSentFlag,
        JSON.stringify(mergedStep1), JSON.stringify(mergedStep2), JSON.stringify(mergedAll)
      ], function(err) {
        if (err) reject(err); else resolve();
      });
    });

    // Save cleanly to Firebase under /firstoption_agency/{email_key}
    const fbRecord = {
      company: 'firstoption_agency',
      email,
      name: finalName,
      phone: finalPhone,
      status: finalStatus,
      meta_sent: metaSentFlag === 1,
      step1_data: mergedStep1,
      step2_data: mergedStep2,
      all_form_data: mergedAll,
      updated_at: new Date().toISOString()
    };

    firebaseService.saveValdhoAppointment(emailKey, fbRecord).catch(e => console.error(e));

    // Auto-Schedule WhatsApp follow-up sequence
    if (finalStatus === 'completed') {
      console.log(`[Auto Scheduler] Lead ${email} completed Step 2 (Full Form). Canceling Step 1 Half Form reminders!`);
      await cancelSchedulesForEmail(email);

      const choices = [];
      Object.keys(mergedAll).forEach(k => { if (Array.isArray(mergedAll[k])) choices.push(...mergedAll[k]); });
      const msgText = HARDCODED_FULL_FORM_TEMPLATE.replace(/\{name\}/g, finalName).replace(/\{answers\}/g, choices.join(', ') || 'Step 2 Completed');

      await scheduleMessage({ email, phone: finalPhone, lead_name: finalName, form_type: 'full_form', message_text: msgText, delayMinutes: WHATSAPP_REPEAT_MINUTES });
    } else {
      const msgText = HARDCODED_HALF_FORM_TEMPLATE.replace(/\{name\}/g, finalName);
      await scheduleMessage({ email, phone: finalPhone, lead_name: finalName, form_type: 'half_form', message_text: msgText, delayMinutes: META_DELAY_MINUTES });
    }

    res.json({ status: 'ok', message: 'Webhook processed successfully', email, form_type: finalStatus });
  } catch (err) {
    console.error('[Valdho Webhook Error]:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// -------------------------------------------------------------
// BACKGROUND DISPATCH TICKER (5m META EVENT & 1m WHATSAPP REPEATS)
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
          // Check safety & Meta retargeting event
          if (item.form_type === 'half_form' && item.email) {
            const leadRow = await new Promise((res) => {
              db.get('SELECT status, meta_sent, step2_data FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [item.email], (e, r) => res(r));
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

            // Lead HAS NOT completed Step 2 after 5m -> Trigger Meta Retargeting Event EXACTLY 1 TIME PER LEAD!
            if (leadRow && !leadRow.meta_sent) {
              console.log(`[Meta Retargeting Engine] Lead ${item.email} waiting for Full Form (5m passed). Dispatching Meta CAPI LeadIncomplete event (1-TIME ONLY)!`);
              
              // Mark meta_sent = 1 locally and in Firebase
              db.run(`UPDATE valdho_appointments SET meta_sent = 1 WHERE LOWER(email) = LOWER(?)`, [item.email]);
              const emailKey = item.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
              firebaseService.saveValdhoAppointment(emailKey, { email: item.email, meta_sent: true }).catch(e => console.error(e));

              // Send to Meta CAPI
              metaCapiService.sendMetaRetargetingEvent(item.email, item.phone, item.lead_name).catch(e => console.error(e));
            }
          }

          // Dispatch WhatsApp message via Evolution API
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

          // Continuous Repeat Sequence: Auto-schedule next 1m WhatsApp message!
          if (result.success && item.email) {
            console.log(`[Valdho Dispatcher] Auto-scheduling next 1m WhatsApp repeat message for ${item.email}...`);
            scheduleMessage({
              email: item.email,
              phone: item.phone,
              lead_name: item.lead_name,
              form_type: item.form_type,
              message_text: item.message_text,
              delayMinutes: WHATSAPP_REPEAT_MINUTES
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
app.get('/api/valdho/appointments', async (req, res) => {
  // Sync from Firebase first so data is NEVER 0 on server restart
  await syncAppointmentsFromFirebase();

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
