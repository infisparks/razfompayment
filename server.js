require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

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

// API endpoint to fetch all stored payments
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
        console.log(`Payment stored/updated: ${payment_id} - ${status}`);
      }
    });
  }

  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL should be configured as: https://raz.infiplus.in/webhook`);
});
