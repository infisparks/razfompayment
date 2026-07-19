require('dotenv').config();
const db = require('../db');
const firebaseService = require('../services/firebaseService');

const payloadStep1 = {
  "timestamp": "2026-07-19T14:45:20.971Z",
  "source": "valdho",
  "form_data": {
    "First Name": "mudassir ",
    "Email": "mudassirs472@gmail.com",
    "Phone Number": "919958399157"
  },
  "meta": {
    "submission_time": "2026-07-19T14:45:20.972Z",
    "user_agent": "Valdho Form Builder",
    "form_fields_count": 3
  }
};

const payloadStep2 = {
  "timestamp": "2026-07-19T14:45:29.703Z",
  "source": "valdho",
  "form_data": {
    "2-qt30U4oFrjsx3ktRjt-_email": "mudassirs472@gmail.com",
    "cywSbuBtbaqSl0XVX3XDN_multiple-choice": ["Doctor / Clinic"],
    "nJHFDbRpnfJvRAtqOUdx3_multiple-choice": ["Founder / Owner"],
    "4PfxBLzmNynSsvbl8M9PM_multiple-choice": ["Below ₹5L", "₹50L+"],
    "BuoXJ7kzEul1EC2ZCagxe_multiple-choice": ["Yes"]
  },
  "meta": {
    "submission_time": "2026-07-19T14:45:29.703Z",
    "user_agent": "Valdho Form Builder",
    "form_fields_count": 5
  }
};

async function processValdhoWebhookDirect(payload) {
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

  let existing = await new Promise((resolve) => {
    db.get('SELECT * FROM valdho_appointments WHERE email = ?', [email], (err, row) => resolve(row || null));
  });

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

  await new Promise((resolve) => {
    db.run(query, [
      appointmentRecord.email,
      appointmentRecord.name,
      appointmentRecord.phone,
      JSON.stringify(step1_data),
      JSON.stringify(step2_data),
      JSON.stringify(all_form_data),
      status
    ], function(err) {
      if (err) console.error("DB Error:", err);
      else console.log(`[SQLite Success] Saved ${appointmentRecord.email} - Status: ${status}`);
      resolve();
    });
  });

  const fbResult = await firebaseService.saveValdhoAppointment(appointmentRecord);
  console.log(`[Firebase Result]`, fbResult);
}

async function runTest() {
  // Wait 500ms for db init
  await new Promise(r => setTimeout(r, 500));
  
  console.log("=== 1. Processing Step 1 Webhook Payload ===");
  await processValdhoWebhookDirect(payloadStep1);

  console.log("\n=== 2. Processing Step 2 Webhook Payload ===");
  await processValdhoWebhookDirect(payloadStep2);

  console.log("\n=== 3. Reading Final Merged Record from SQLite ===");
  db.get('SELECT * FROM valdho_appointments WHERE email = ?', ['mudassirs472@gmail.com'], (err, row) => {
    if (err) console.error(err);
    else {
      console.log("Final Merged DB Record:", {
        id: row.id,
        email: row.email,
        name: row.name,
        phone: row.phone,
        status: row.status,
        step1_data: JSON.parse(row.step1_data),
        step2_data: JSON.parse(row.step2_data),
        all_form_data: JSON.parse(row.all_form_data)
      });
    }
  });
}

runTest();
