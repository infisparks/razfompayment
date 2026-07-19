const express = require('express');
const path = require('path');
const db = require('../db');
const firebase = require('./firebase');
const whatsapp = require('./whatsapp');
const scheduler = require('./scheduler');

const router = express.Router();

// Helper to process Valdho 2-step webhooks
async function processValdhoWebhook(payload) {
  if (!payload || !payload.form_data) {
    throw new Error('Invalid Valdho webhook payload');
  }

  const formData = payload.form_data || {};
  let email = null;
  let name = null;
  let phone = null;

  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'email' || lowerKey.endsWith('_email')) {
      email = String(formData[key]).trim();
      break;
    }
  }

  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('name') || lowerKey.includes('first name')) {
      name = String(formData[key]).trim();
      break;
    }
  }

  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('phone') || lowerKey.includes('contact')) {
      phone = String(formData[key]).trim();
      break;
    }
  }

  const isStep1 = !!(name || phone || formData["First Name"] || formData["Phone Number"]);
  const isStep2 = Object.keys(formData).some(k => k.endsWith('_email') || k.includes('multiple-choice') || Array.isArray(formData[k]));

  let existing = null;
  if (email) {
    existing = await new Promise((resolve) => {
      db.get('SELECT * FROM valdho_appointments WHERE email = ?', [email], (err, row) => resolve(row || null));
    });
  }

  let step1_data = {};
  let step2_data = {};
  let all_form_data = {};

  if (existing) {
    try { step1_data = JSON.parse(existing.step1_data || '{}'); } catch(e){}
    try { step2_data = JSON.parse(existing.step2_data || '{}'); } catch(e){}
    try { all_form_data = JSON.parse(existing.all_form_data || '{}'); } catch(e){}
    name = name || existing.name;
    phone = phone || existing.phone;
  }

  if (isStep1 || !existing) step1_data = { ...step1_data, ...formData };
  if (isStep2) step2_data = { ...step2_data, ...formData };

  all_form_data = { ...all_form_data, ...formData };

  const status = (isStep2 || (step2_data && Object.keys(step2_data).length > 0)) ? 'completed' : 'step1_received';

  const appointmentRecord = {
    email: email || `unknown_${Date.now()}@valdho.com`,
    name: name || 'Valdho Lead',
    phone: phone || 'N/A',
    source: payload.source || 'valdho',
    agency: 'firstoption_agency',
    step1_data,
    step2_data,
    all_form_data,
    status,
    raw_payload: payload,
    updated_at: new Date().toISOString()
  };

  // 1. Save SQLite
  const query = `
    INSERT INTO valdho_appointments (email, name, phone, step1_data, step2_data, all_form_data, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      name = COALESCE(excluded.name, valdho_appointments.name),
      phone = COALESCE(excluded.phone, valdho_appointments.phone),
      step1_data = excluded.step1_data,
      step2_data = excluded.step2_data,
      all_form_data = excluded.all_form_data,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `;

  db.run(query, [
    appointmentRecord.email,
    appointmentRecord.name,
    appointmentRecord.phone,
    JSON.stringify(step1_data),
    JSON.stringify(step2_data),
    JSON.stringify(all_form_data),
    status
  ]);

  // 2. Save Firebase
  firebase.saveAppointment(appointmentRecord).catch(e => console.error(e));

  return appointmentRecord;
}

// -------------------------------------------------------------
// WEBHOOK RECEIVERS
// -------------------------------------------------------------
const webhookHandler = async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Valdho Webhook Received]:', JSON.stringify(payload, null, 2));
    const result = await processValdhoWebhook(payload);
    res.status(200).json({ status: 'ok', message: 'Valdho webhook processed', email: result.email });
  } catch (err) {
    console.error('[Valdho Webhook Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
};

router.post('/webhook', webhookHandler);
router.post('/api/valdho/webhook', webhookHandler);

// -------------------------------------------------------------
// APPOINTMENTS API
// -------------------------------------------------------------
router.get('/api/valdho/appointments', async (req, res) => {
  try {
    const fbAppointments = await firebase.getAppointments();
    db.all('SELECT * FROM valdho_appointments ORDER BY updated_at DESC', [], (err, rows) => {
      const dbAppointments = rows || [];
      const map = new Map();

      dbAppointments.forEach(row => {
        let step1_data = {}, step2_data = {}, all_form_data = {};
        try { step1_data = typeof row.step1_data === 'string' ? JSON.parse(row.step1_data) : (row.step1_data || {}); } catch(e){}
        try { step2_data = typeof row.step2_data === 'string' ? JSON.parse(row.step2_data) : (row.step2_data || {}); } catch(e){}
        try { all_form_data = typeof row.all_form_data === 'string' ? JSON.parse(row.all_form_data) : (row.all_form_data || {}); } catch(e){}

        map.set(row.email.toLowerCase(), { ...row, step1_data, step2_data, all_form_data });
      });

      (fbAppointments || []).forEach(fbItem => {
        if (fbItem && (fbItem.email || fbItem.id)) {
          const emailKey = (fbItem.email || fbItem.id).toLowerCase();
          const existing = map.get(emailKey) || {};
          map.set(emailKey, { ...existing, ...fbItem });
        }
      });

      res.json(Array.from(map.values()));
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

router.delete('/api/valdho/appointments/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    console.log(`[Delete Appointment] Removing ${email} and canceling pending scheduled messages.`);

    await scheduler.cancelSchedulesForEmail(email);
    db.run('DELETE FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [email]);
    await firebase.deleteAppointment(email);

    res.json({ status: 'ok', message: `Appointment and scheduled messages for ${email} deleted.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// -------------------------------------------------------------
// WHATSAPP API & SCHEDULING
// -------------------------------------------------------------
router.post('/api/valdho/whatsapp/send', async (req, res) => {
  try {
    const { phone, text, email } = req.body;
    if (!phone || !text) return res.status(400).json({ error: 'Phone and text are required' });

    const result = await whatsapp.sendEvolutionWhatsApp(phone, text);
    
    // Log message dispatch
    const logData = {
      id: 'log_' + Date.now(),
      email: email || 'N/A',
      phone: phone,
      message_text: text,
      status: result.success ? 'sent' : 'failed',
      error_message: result.success ? null : JSON.stringify(result.error)
    };

    db.run(
      `INSERT INTO whatsapp_logs (message_id, recipient, payment_id, status, error_message, raw_payload) VALUES (?, ?, ?, ?, ?, ?)`,
      [logData.id, phone, email || 'N/A', logData.status, logData.error_message, JSON.stringify(result)]
    );
    firebase.saveMessageLog(logData).catch(e => console.error(e));

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/valdho/whatsapp/schedule', async (req, res) => {
  try {
    const { email, phone, lead_name, form_type, message_text, interval, scheduled_at } = req.body;
    if (!phone || !message_text) return res.status(400).json({ error: 'Phone and text are required' });

    const record = await scheduler.scheduleMessage({
      email,
      phone,
      lead_name,
      form_type: form_type || 'half_form',
      message_text,
      interval,
      scheduled_at
    });

    res.json({ status: 'ok', data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/valdho/whatsapp/schedules', async (req, res) => {
  db.all('SELECT * FROM whatsapp_schedules ORDER BY id DESC', [], async (err, rows) => {
    if (err || !rows || rows.length === 0) {
      try {
        const fbSchedules = await firebase.getSchedules();
        return res.json(fbSchedules);
      } catch (fbErr) {
        return res.json(rows || []);
      }
    }
    res.json(rows);
  });
});

router.delete('/api/valdho/whatsapp/schedules/:id', async (req, res) => {
  try {
    await scheduler.cancelScheduleById(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Message Logs
router.get('/api/valdho/whatsapp/logs', async (req, res) => {
  db.all('SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT 100', [], async (err, rows) => {
    if (err || !rows || rows.length === 0) {
      try {
        const fbLogs = await firebase.getMessageLogs();
        return res.json(fbLogs);
      } catch (fbErr) {
        return res.json(rows || []);
      }
    }
    res.json(rows);
  });
});

// -------------------------------------------------------------
// AUTOMATION ENGINE CONTROLS (PAUSE / RESUME)
// -------------------------------------------------------------
router.post('/api/valdho/automation/pause', (req, res) => {
  const status = scheduler.pauseAutomation();
  res.json({ status: 'ok', ...status });
});

router.post('/api/valdho/automation/resume', (req, res) => {
  const status = scheduler.resumeAutomation();
  res.json({ status: 'ok', ...status });
});

router.get('/api/valdho/automation/status', (req, res) => {
  res.json(scheduler.getAutomationStatus());
});

module.exports = router;
