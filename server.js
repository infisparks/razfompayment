require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const evolutionWhatsappService = require('./services/evolutionWhatsappService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Serve single page for dashboard
app.get(['/', '/valdho', '/valdho_first_option_agency', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Professional Welcome Message Template (First Option Agency)
const FIRST_OPTION_WELCOME_TEMPLATE = `*Dear {name},*

Welcome to *First Option Agency*! 🚀

We help Doctors, Manufacturers, IT Companies & Growing Businesses turn clicks into real appointments & sales — on autopilot.

*Ready to Turn Your Business Into a Client-Getting Machine?*

Please complete your growth survey to finalize your appointment request and book your growth session:

👉 *Complete Survey Now:* https://firstoptionagency.in/FOA-Servey-page

*What We Do:*
✅ Performance Marketing (Paid Ads)
✅ Organic Content (Trust & Authority)
✅ Automated High-Converting Funnels
✅ Predictable Revenue Systems

Best Regards,
*Faiz Ansari*
Founder & Growth Marketer
First Option Agency
https://firstoptionagency.in`;

// Recursive Deep Extractor for Name
function extractDeepName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    const kLower = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((kLower.includes('name') || kLower.includes('firstname') || kLower.includes('first')) && typeof obj[k] === 'string') {
      const val = obj[k].trim();
      if (val && val !== 'Valdho Lead' && !val.includes('@')) return val;
    }
    if (typeof obj[k] === 'object') {
      const found = extractDeepName(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

// Recursive Deep Extractor for Phone
function extractDeepPhone(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    const kLower = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((kLower.includes('phone') || kLower.includes('mobile') || kLower.includes('contact') || kLower.includes('number')) && typeof obj[k] === 'string') {
      const digits = obj[k].replace(/\D/g, '');
      if (digits.length >= 10) return obj[k].trim();
    }
    if (typeof obj[k] === 'object') {
      const found = extractDeepPhone(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

// -------------------------------------------------------------
// WEBHOOK ENDPOINT (/valdho/webhook)
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

    const finalName = extractDeepName(formData) || extractDeepName(payload) || extractDeepName(mergedStep1) || extractDeepName(mergedAll)
      || (existing && existing.name && existing.name !== 'Valdho Lead' ? existing.name : null)
      || 'Valdho Lead';

    const finalPhone = extractDeepPhone(formData) || extractDeepPhone(payload) || extractDeepPhone(mergedStep1) || extractDeepPhone(mergedAll)
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

    // Send Professional First Option Agency Welcome WhatsApp Message on form submission
    if (finalPhone && finalPhone !== 'N/A') {
      const welcomeMsg = FIRST_OPTION_WELCOME_TEMPLATE.replace(/\{name\}/g, finalName || 'Valdho Lead');
      console.log(`[First Option Agency] Sending professional welcome message to ${finalPhone}...`);
      evolutionWhatsappService.sendEvolutionWhatsApp(finalPhone, welcomeMsg).catch(e => console.error(e));
    }

    res.json({ status: 'ok', message: 'Webhook processed & welcome WhatsApp message sent successfully', email, name: finalName, phone: finalPhone });
  } catch (err) {
    console.error('[Valdho Webhook Error]:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Dashboard APIs
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
  res.json({ status: 'ok', message: `Appointment for ${email} deleted successfully` });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` First Option Agency Server running on port ${PORT}`);
  console.log(` Dashboard URL: http://localhost:${PORT}`);
  console.log(` Webhook URL: http://localhost:${PORT}/valdho/webhook`);
  console.log(`=======================================================`);
});
