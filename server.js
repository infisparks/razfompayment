require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const whatsappService = require('./services/whatsappService');
const whatsappWebhookService = require('./services/whatsappWebhookService');
const firebaseService = require('./services/firebaseService');
const evolutionWhatsappService = require('./services/evolutionWhatsappService');
const schedulerService = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_secret';

// Enable CORS
app.use(cors());

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Page route for Valdho Appointments Dashboard
app.get(['/valdho', '/valdho_first_option_agency', '/valdho_first_option_agency.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'valdho_first_option_agency.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Middleware to capture the raw body for Razorpay signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));


// API endpoint to fetch all stored payments from SQLite
app.get('/api/payments', (req, res) => {
  const query = 'SELECT * FROM payments ORDER BY received_at DESC';
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching payments:', err.message);
      return res.status(500).json({ error: 'Database error fetching payments' });
    }
    res.json(rows);
  });
});

// API endpoint to fetch all payments directly from Firebase under /razorpay/payments
app.get('/api/firebase/payments', async (req, res) => {
  try {
    const payments = await firebaseService.getAllPayments();
    res.json(payments);
  } catch (err) {
    console.error('Error fetching payments from Firebase:', err.message);
    res.status(500).json({ error: 'Failed to fetch Firebase payments' });
  }
});

// POST route to handle Razorpay Webhooks
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  
  if (!signature) {
    console.warn('Webhook request received without x-razorpay-signature header');
    return res.status(400).json({ error: 'Signature missing' });
  }

  // Verify the signature using HMAC hex digest
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(req.rawBody || '')
    .digest('hex');

  if (expectedSignature !== signature) {
    console.error('Webhook signature verification failed! Signature mismatch.');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  const event = payload.event;
  console.log(`Verified Webhook event: ${event}`);

  // We are primarily tracking payment.captured and payment.failed
  if (event === 'payment.captured' || event === 'payment.failed') {
    console.log('Payment Received');
    const payment = payload.payload.payment.entity;

    const payment_id = payment.id;
    const amount = payment.amount; // stored in paise (e.g. 100 paise = 1.00 INR)
    const currency = payment.currency;
    const status = payment.status;
    const method = payment.method;
    const email = payment.email;
    const phone = payment.contact;
    const created_at = payment.created_at;
    const raw_payload = JSON.stringify(payload);

    // Parse the custom 'enter you company name' field from notes
    let company_name = '';
    if (payment.notes) {
      const keys = Object.keys(payment.notes);
      const companyKey = keys.find(k => k.toLowerCase().includes('company'));
      if (companyKey) {
        company_name = payment.notes[companyKey];
      }
    }

    // Prepare payment object for Firebase under /razorpay/payments/{payment_id}
    const paymentData = {
      payment_id,
      amount,
      currency,
      status,
      method,
      email,
      phone,
      company_name,
      created_at,
      received_at: new Date().toISOString(),
      raw_payload: payload
    };

    // Save/update to Firebase asynchronously under /razorpay/payments node
    firebaseService.savePayment(paymentData).catch((fbErr) => {
      console.error('Firebase save error:', fbErr);
    });

    const query = `
      INSERT INTO payments (payment_id, amount, currency, status, method, email, phone, company_name, created_at, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(payment_id) DO UPDATE SET
        status = excluded.status,
        raw_payload = excluded.raw_payload
    `;

    db.run(query, [payment_id, amount, currency, status, method, email, phone, company_name, created_at, raw_payload], function(err) {
      if (err) {
        console.error('Failed to store payment in database:', err.message);
      } else {
        console.log('Payment Stored');
        console.log(`Payment stored/updated: ${payment_id} - ${status}`);

        // Only send WhatsApp message if payment status is captured
        if (status === 'captured') {
          console.log('Sending WhatsApp...');
          whatsappService.sendPaymentSuccess(phone, company_name, amount)
            .then((result) => {
              if (result.success) {
                console.log('WhatsApp Sent Successfully');
                console.log('WhatsApp Accepted');

                // Extract message ID to store
                const message_id = result.data && result.data.messages && result.data.messages[0] ? result.data.messages[0].id : null;
                const recipient = result.data && result.data.contacts && result.data.contacts[0] ? result.data.contacts[0].wa_id : phone;

                if (message_id) {
                  const logQuery = `
                    INSERT INTO whatsapp_logs (message_id, recipient, payment_id, status, raw_payload)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(message_id) DO UPDATE SET
                      payment_id = COALESCE(excluded.payment_id, whatsapp_logs.payment_id),
                      status = excluded.status,
                      raw_payload = excluded.raw_payload
                  `;
                  db.run(logQuery, [message_id, recipient, payment_id, 'accepted', JSON.stringify(result.data)], (logErr) => {
                    if (logErr) {
                      console.error('Failed to insert initial WhatsApp log:', logErr.message);
                    }
                  });
                }
              } else {
                console.log('WhatsApp Failed');
                console.error(`WhatsApp send failed for Payment ID: ${payment_id}, Phone: ${phone}. Error response:`, JSON.stringify(result.error));
              }
            })
            .catch((error) => {
              console.log('WhatsApp Failed');
              console.error(`WhatsApp send error for Payment ID: ${payment_id}, Phone: ${phone}. Error:`, error.message || error);
            });
        }
      }
    });
  }

  res.json({ status: 'ok' });
});

// GET route for WhatsApp Webhook Verification
app.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'infiplus_whatsapp_verify';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp Webhook Verified Successfully');
    return res.status(200).send(challenge);
  } else {
    console.error('WhatsApp Webhook verification failed! Token mismatch.');
    return res.sendStatus(403);
  }
});

// POST route to receive WhatsApp Webhook updates
app.post('/whatsapp/webhook', (req, res) => {
  const payload = req.body;
  
  // Return HTTP 200 immediately to Meta
  res.status(200).json({ status: 'ok' });

  // Process the webhook asynchronously so we never block Meta
  try {
    whatsappWebhookService.parseWebhook(payload);
  } catch (error) {
    console.error('Error processing WhatsApp Webhook payload:', error.message || error);
  }
});

/**
 * Helper function to parse and process Valdho webhook data (Step 1 and Step 2)
 */
async function processValdhoWebhook(payload) {
  if (!payload || !payload.form_data) {
    throw new Error('Invalid Valdho webhook payload');
  }

  const formData = payload.form_data || {};
  let email = null;
  let name = null;
  let phone = null;

  // Extract Email
  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'email' || lowerKey.endsWith('_email')) {
      email = String(formData[key]).trim();
      break;
    }
  }

  // Extract Name
  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('name') || lowerKey.includes('first name')) {
      name = String(formData[key]).trim();
      break;
    }
  }

  // Extract Phone
  for (const key of Object.keys(formData)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('phone') || lowerKey.includes('contact')) {
      phone = String(formData[key]).trim();
      break;
    }
  }

  const isStep1 = !!(name || phone || formData["First Name"] || formData["Phone Number"]);
  const isStep2 = Object.keys(formData).some(k => k.endsWith('_email') || k.includes('multiple-choice') || Array.isArray(formData[k]));

  // Retrieve existing record from SQLite if available
  let existing = null;
  if (email) {
    existing = await new Promise((resolve) => {
      db.get('SELECT * FROM valdho_appointments WHERE email = ?', [email], (err, row) => {
        resolve(row || null);
      });
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

  if (isStep1 || !existing) {
    step1_data = { ...step1_data, ...formData };
  }
  if (isStep2) {
    step2_data = { ...step2_data, ...formData };
  }

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

  // 1. Save / Update in SQLite
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
  ], (err) => {
    if (err) {
      console.error('Failed to store Valdho appointment in SQLite database:', err.message);
    } else {
      console.log(`Valdho Appointment stored/updated in SQLite for email: ${appointmentRecord.email}`);
    }
  });

  // 2. Save / Update in Firebase under node /firstoption_agency
  firebaseService.saveValdhoAppointment(appointmentRecord).catch((fbErr) => {
    console.error('Firebase saveValdhoAppointment error:', fbErr);
  });

  return appointmentRecord;
}

// POST routes for Valdho Form Webhooks (handles /valdho/webhook, /api/valdho/webhook, /webhook/valdho_first_option_agency)
const valdhoWebhookHandler = async (req, res) => {
  try {
    const payload = req.body;
    console.log('Valdho Webhook received:', JSON.stringify(payload, null, 2));
    const result = await processValdhoWebhook(payload);
    res.status(200).json({ status: 'ok', message: 'Valdho webhook processed successfully', email: result.email });
  } catch (error) {
    console.error('Error processing Valdho Webhook:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to process Valdho webhook' });
  }
};

app.post('/valdho/webhook', valdhoWebhookHandler);
app.post('/api/valdho/webhook', valdhoWebhookHandler);
app.post('/webhook/valdho_first_option_agency', valdhoWebhookHandler);

// GET API route for Valdho Appointments
app.get('/api/valdho/appointments', async (req, res) => {
  try {
    // 1. Fetch directly from Firebase under node /firstoption_agency
    const fbAppointments = await firebaseService.getValdhoAppointments();

    // 2. Fetch from SQLite
    db.all('SELECT * FROM valdho_appointments ORDER BY updated_at DESC', [], (err, rows) => {
      const dbAppointments = rows || [];
      const map = new Map();

      // Add SQLite records
      dbAppointments.forEach(row => {
        let step1_data = {}, step2_data = {}, all_form_data = {};
        try { step1_data = typeof row.step1_data === 'string' ? JSON.parse(row.step1_data) : (row.step1_data || {}); } catch(e){}
        try { step2_data = typeof row.step2_data === 'string' ? JSON.parse(row.step2_data) : (row.step2_data || {}); } catch(e){}
        try { all_form_data = typeof row.all_form_data === 'string' ? JSON.parse(row.all_form_data) : (row.all_form_data || {}); } catch(e){}

        map.set(row.email.toLowerCase(), {
          ...row,
          step1_data,
          step2_data,
          all_form_data
        });
      });

      // Add / override with Firebase records
      (fbAppointments || []).forEach(fbItem => {
        if (fbItem && (fbItem.email || fbItem.id)) {
          const emailKey = (fbItem.email || fbItem.id).toLowerCase();
          const existing = map.get(emailKey) || {};
          map.set(emailKey, {
            ...existing,
            ...fbItem
          });
        }
      });

      const resultList = Array.from(map.values());
      res.json(resultList);
    });
  } catch (error) {
    console.error('Error fetching Valdho appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// POST route to send instant WhatsApp message via Evolution API
app.post('/api/valdho/whatsapp/send', async (req, res) => {
  try {
    const { phone, text } = req.body;
    if (!phone || !text) {
      return res.status(400).json({ error: 'Phone number and message text are required' });
    }

    const result = await evolutionWhatsappService.sendEvolutionWhatsApp(phone, text);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('Error in /api/valdho/whatsapp/send:', err);
    res.status(500).json({ error: err.message || 'Failed to send WhatsApp message' });
  }
});

// POST route to schedule a WhatsApp message (e.g. after 5 days, 10 days, or on a specific date)
app.post('/api/valdho/whatsapp/schedule', async (req, res) => {
  try {
    const { email, phone, lead_name, form_type, message_text, scheduled_at, days_delay } = req.body;

    if (!phone || !message_text) {
      return res.status(400).json({ error: 'Phone number and message text are required' });
    }

    let targetDate;
    if (days_delay && !isNaN(days_delay)) {
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + parseInt(days_delay));
    } else if (scheduled_at) {
      targetDate = new Date(scheduled_at);
    } else {
      // Default fallback: 1 day
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 1);
    }

    const record = await schedulerService.scheduleMessage({
      email,
      phone,
      lead_name,
      form_type: form_type || 'half_form',
      message_text,
      scheduled_at: targetDate
    });

    res.status(200).json({ status: 'ok', message: 'WhatsApp message scheduled successfully', data: record });
  } catch (err) {
    console.error('Error in /api/valdho/whatsapp/schedule:', err);
    res.status(500).json({ error: err.message || 'Failed to schedule WhatsApp message' });
  }
});

// GET route to list all scheduled WhatsApp messages
app.get('/api/valdho/whatsapp/schedules', async (req, res) => {
  db.all('SELECT * FROM whatsapp_schedules ORDER BY id DESC', [], async (err, rows) => {
    if (err || !rows || rows.length === 0) {
      try {
        const fbSchedules = await firebaseService.getValdhoSchedules();
        return res.json(fbSchedules);
      } catch (fbErr) {
        return res.json(rows || []);
      }
    }
    res.json(rows);
  });
});

// DELETE route for Valdho Appointment (also cancels all scheduled messages for that lead)
app.delete('/api/valdho/appointments/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    console.log(`[DELETE Request] Deleting appointment and canceling scheduled messages for ${email}`);

    // 1. Cancel/Delete scheduled WhatsApp messages in SQLite & Firebase
    await schedulerService.cancelSchedulesForEmail(email);

    // 2. Delete appointment from SQLite
    db.run('DELETE FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [email], (err) => {
      if (err) console.error('Error deleting appointment from SQLite:', err.message);
    });

    // 3. Delete appointment from Firebase node /firstoption_agency
    await firebaseService.deleteValdhoAppointment(email);

    res.json({ status: 'ok', message: `Appointment and scheduled messages for ${email} deleted successfully.` });
  } catch (err) {
    console.error('Error deleting appointment:', err);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// DELETE route for individual scheduled message
app.delete('/api/valdho/whatsapp/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await schedulerService.cancelScheduleById(id);
    res.json({ status: 'ok', message: `Scheduled message ID ${id} deleted successfully.` });
  } catch (err) {
    console.error('Error deleting schedule:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// Start server and initialize background scheduler engine
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL should be configured as: https://raz.infiplus.in/webhook`);
  console.log(`Valdho Webhook URL endpoint: https://raz.infiplus.in/valdho/webhook`);
  
  // Start background scheduler worker
  schedulerService.startScheduler();
});
