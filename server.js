require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const whatsappService = require('./services/whatsappService');
const whatsappWebhookService = require('./services/whatsappWebhookService');
const firebaseService = require('./services/firebaseService');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_secret';

// Enable CORS
app.use(cors());

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to capture the raw body for Razorpay signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

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
  const query = 'SELECT * FROM valdho_appointments ORDER BY updated_at DESC';
  db.all(query, [], async (err, rows) => {
    if (err || !rows || rows.length === 0) {
      // Fallback to Firebase if local DB is empty
      try {
        const fbAppointments = await firebaseService.getValdhoAppointments();
        return res.json(fbAppointments);
      } catch (fbErr) {
        return res.json(rows || []);
      }
    }
    res.json(rows);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL should be configured as: https://raz.infiplus.in/webhook`);
  console.log(`Valdho Webhook URL endpoint: https://raz.infiplus.in/valdho/webhook`);
});
