require('dotenv').config();
const express = require('express');
const cors = require('cors');
const evolutionWhatsappService = require('./services/evolutionWhatsappService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

app.get('/', (req, res) => {
  res.json({ service: 'First Option Agency Webhook Engine', status: 'active', time: new Date() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Friendly & Professional First Option Agency Welcome Message Template
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
// WEBHOOK HANDLER (/valdho/webhook)
// -------------------------------------------------------------
app.post('/valdho/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[Valdho Webhook Received]:', JSON.stringify(payload));

    const formData = payload.form_data || payload;

    // Extract Name & Phone Number
    const finalName = extractDeepName(formData) || extractDeepName(payload) || 'Valdho Lead';
    const finalPhone = extractDeepPhone(formData) || extractDeepPhone(payload) || null;

    if (!finalPhone) {
      console.warn('[Valdho Webhook Warning] No valid phone number found in payload');
      return res.status(400).json({ status: 'error', error: 'Missing phone number' });
    }

    // Instantly send friendly welcome WhatsApp message
    const welcomeMsg = FIRST_OPTION_WELCOME_TEMPLATE.replace(/\{name\}/g, finalName);
    console.log(`[First Option Agency] Instantly sending welcome message to ${finalPhone}...`);

    const result = await evolutionWhatsappService.sendEvolutionWhatsApp(finalPhone, welcomeMsg);

    res.json({
      status: 'ok',
      message: 'First form fill webhook received. WhatsApp welcome message sent instantly!',
      name: finalName,
      phone: finalPhone,
      whatsapp_delivered: result.success
    });

  } catch (err) {
    console.error('[Valdho Webhook Error]:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` First Option Agency Webhook Engine running on port ${PORT}`);
  console.log(` Webhook Endpoint: http://localhost:${PORT}/valdho/webhook`);
  console.log(`=======================================================`);
});
