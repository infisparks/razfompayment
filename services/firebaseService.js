const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Firebase Service for managing Razorpay data.
 * All Razorpay related payments and webhook logs are stored under the `/razorpay` node.
 * 
 * Supports both:
 * 1. Firebase Admin SDK (if serviceAccountKey.json is present and firebase-admin installed)
 * 2. Firebase Realtime Database REST API (via axios using databaseURL)
 */

let adminApp = null;
let databaseUrl = process.env.FIREBASE_DATABASE_URL || 'https://billing4-44c05-default-rtdb.firebaseio.com';

// Ensure databaseUrl does not end with trailing slash
if (databaseUrl.endsWith('/')) {
  databaseUrl = databaseUrl.slice(0, -1);
}

// Try initializing Firebase Admin SDK if serviceAccountKey.json exists
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
  try {
    const admin = require('firebase-admin');
    const serviceAccount = require(serviceAccountPath);
    if (!admin.apps.length) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseUrl
      });
      console.log('Firebase Admin SDK initialized successfully with serviceAccountKey.json');
    } else {
      adminApp = admin.app();
    }
  } catch (err) {
    console.warn('Found serviceAccountKey.json but failed to initialize firebase-admin:', err.message);
  }
} else {
  console.log(`Firebase Service initialized using Realtime DB REST API at: ${databaseUrl}`);
}

/**
 * Save or update payment details in Firebase under `/razorpay/payments/{payment_id}`
 * 
 * @param {Object} paymentData - Payment object details
 */
async function savePayment(paymentData) {
  if (!paymentData || !paymentData.payment_id) {
    console.warn('savePayment skipped: missing payment_id in paymentData');
    return { success: false, error: 'Missing payment_id' };
  }

  const paymentId = paymentData.payment_id;
  const nodePath = `razorpay/payments/${paymentId}`;
  const payload = {
    ...paymentData,
    updated_at: new Date().toISOString()
  };

  if (adminApp) {
    try {
      const db = adminApp.database();
      await db.ref(nodePath).update(payload);
      console.log(`[Firebase Admin] Payment ${paymentId} saved under /${nodePath}`);
      return { success: true, method: 'admin_sdk' };
    } catch (err) {
      console.error(`[Firebase Admin Error] Failed to save payment ${paymentId}:`, err.message);
      // Fallback to REST API if Admin SDK call fails
    }
  }

  // Fallback to Realtime Database REST API
  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.patch(targetUrl, payload);
    console.log(`[Firebase REST API] Payment ${paymentId} saved under /${nodePath}`);
    return { success: true, method: 'rest_api' };
  } catch (err) {
    console.error(`[Firebase REST Error] Failed to save payment ${paymentId} to Firebase:`, err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Save or update WhatsApp webhook status log in Firebase under `/razorpay/whatsapp_logs/{message_id}`
 * 
 * @param {Object} logData - Log object details
 */
async function saveWhatsAppLog(logData) {
  if (!logData || !logData.message_id) {
    console.warn('saveWhatsAppLog skipped: missing message_id');
    return { success: false, error: 'Missing message_id' };
  }

  const messageId = logData.message_id;
  const nodePath = `razorpay/whatsapp_logs/${messageId}`;
  const payload = {
    ...logData,
    updated_at: new Date().toISOString()
  };

  if (adminApp) {
    try {
      const db = adminApp.database();
      await db.ref(nodePath).update(payload);
      console.log(`[Firebase Admin] WhatsApp log ${messageId} saved under /${nodePath}`);
      return { success: true, method: 'admin_sdk' };
    } catch (err) {
      console.error(`[Firebase Admin Error] Failed to save WhatsApp log ${messageId}:`, err.message);
    }
  }

  // Fallback to Realtime Database REST API
  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.patch(targetUrl, payload);
    console.log(`[Firebase REST API] WhatsApp log ${messageId} saved under /${nodePath}`);
    return { success: true, method: 'rest_api' };
  } catch (err) {
    console.error(`[Firebase REST Error] Failed to save WhatsApp log ${messageId} to Firebase:`, err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all stored payments under `/razorpay/payments`
 */
async function getAllPayments() {
  const nodePath = `razorpay/payments`;

  if (adminApp) {
    try {
      const db = adminApp.database();
      const snapshot = await db.ref(nodePath).once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    } catch (err) {
      console.error('[Firebase Admin Error] Failed to fetch payments:', err.message);
    }
  }

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    const response = await axios.get(targetUrl);
    const data = response.data;
    return data ? Object.values(data) : [];
  } catch (err) {
    console.error('[Firebase REST Error] Failed to fetch payments:', err.message || err);
    return [];
  }
}

/**
 * Save or update Valdho appointment data in Firebase under `/firstoption_agency/{emailKey}`
 * 
 * @param {Object} appointmentData - Combined step 1 and step 2 appointment details
 */
async function saveValdhoAppointment(appointmentData) {
  if (!appointmentData || (!appointmentData.email && !appointmentData.id)) {
    console.warn('saveValdhoAppointment skipped: missing email or id');
    return { success: false, error: 'Missing email or id' };
  }

  const emailKey = (appointmentData.email || appointmentData.id).toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nodePath = `firstoption_agency/${emailKey}`;

  // If node already has step 1, merge data
  let existingData = {};
  if (adminApp) {
    try {
      const db = adminApp.database();
      const snapshot = await db.ref(nodePath).once('value');
      if (snapshot.exists()) {
        existingData = snapshot.val() || {};
      }
    } catch (e) {
      console.warn('[Firebase Admin] Error reading existing node:', e.message);
    }
  } else {
    try {
      const targetUrl = `${databaseUrl}/${nodePath}.json`;
      const res = await axios.get(targetUrl);
      if (res.data) {
        existingData = res.data;
      }
    } catch (e) {
      // ignore
    }
  }

  const payload = {
    ...existingData,
    ...appointmentData,
    step1_data: { ...(existingData.step1_data || {}), ...(appointmentData.step1_data || {}) },
    step2_data: { ...(existingData.step2_data || {}), ...(appointmentData.step2_data || {}) },
    all_form_data: { ...(existingData.all_form_data || {}), ...(appointmentData.all_form_data || {}) },
    updated_at: new Date().toISOString()
  };

  if (!payload.created_at) {
    payload.created_at = new Date().toISOString();
  }

  if (adminApp) {
    try {
      const db = adminApp.database();
      await db.ref(nodePath).set(payload);
      console.log(`[Firebase Admin] Valdho appointment saved under /${nodePath}`);
      return { success: true, method: 'admin_sdk' };
    } catch (err) {
      console.error(`[Firebase Admin Error] Failed to save appointment:`, err.message);
    }
  }

  // Fallback to Realtime Database REST API
  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.put(targetUrl, payload);
    console.log(`[Firebase REST API] Valdho appointment saved under /${nodePath}`);
    return { success: true, method: 'rest_api' };
  } catch (err) {
    console.error(`[Firebase REST Error] Failed to save appointment to Firebase:`, err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all stored appointments under `/firstoption_agency`
 */
async function getValdhoAppointments() {
  const nodePath = `firstoption_agency`;

  if (adminApp) {
    try {
      const db = adminApp.database();
      const snapshot = await db.ref(nodePath).once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    } catch (err) {
      console.error('[Firebase Admin Error] Failed to fetch Valdho appointments:', err.message);
    }
  }

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    const response = await axios.get(targetUrl);
    const data = response.data;
    return data ? Object.values(data) : [];
  } catch (err) {
    console.error('[Firebase REST Error] Failed to fetch Valdho appointments:', err.message || err);
    return [];
  }
}

module.exports = {
  savePayment,
  saveWhatsAppLog,
  getAllPayments,
  saveValdhoAppointment,
  getValdhoAppointments
};
