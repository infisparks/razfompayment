const axios = require('axios');
const fs = require('fs');
const path = require('path');

let adminApp = null;
let databaseUrl = process.env.FIREBASE_DATABASE_URL || 'https://billing4-44c05-default-rtdb.firebaseio.com';

if (databaseUrl.endsWith('/')) {
  databaseUrl = databaseUrl.slice(0, -1);
}

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
    } else {
      adminApp = admin.app();
    }
  } catch (err) {
    console.warn('[Firebase] Admin SDK init failed:', err.message);
  }
}

// -------------------------------------------------------------
// APPOINTMENTS (/firstoption_agency)
// -------------------------------------------------------------
async function saveAppointment(appointmentData) {
  if (!appointmentData || (!appointmentData.email && !appointmentData.id)) {
    return { success: false, error: 'Missing email or id' };
  }

  const emailKey = (appointmentData.email || appointmentData.id).toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nodePath = `firstoption_agency/${emailKey}`;

  let existingData = {};
  if (adminApp) {
    try {
      const db = adminApp.database();
      const snapshot = await db.ref(nodePath).once('value');
      if (snapshot.exists()) existingData = snapshot.val() || {};
    } catch (e) {}
  } else {
    try {
      const res = await axios.get(`${databaseUrl}/${nodePath}.json`);
      if (res.data) existingData = res.data;
    } catch (e) {}
  }

  const payload = {
    ...existingData,
    ...appointmentData,
    step1_data: { ...(existingData.step1_data || {}), ...(appointmentData.step1_data || {}) },
    step2_data: { ...(existingData.step2_data || {}), ...(appointmentData.step2_data || {}) },
    all_form_data: { ...(existingData.all_form_data || {}), ...(appointmentData.all_form_data || {}) },
    updated_at: new Date().toISOString()
  };

  if (!payload.created_at) payload.created_at = new Date().toISOString();

  if (adminApp) {
    try {
      await adminApp.database().ref(nodePath).set(payload);
      return { success: true };
    } catch (err) {}
  }

  try {
    await axios.put(`${databaseUrl}/${nodePath}.json`, payload);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getAppointments() {
  const nodePath = `firstoption_agency`;
  if (adminApp) {
    try {
      const snapshot = await adminApp.database().ref(nodePath).once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    } catch (err) {}
  }
  try {
    const response = await axios.get(`${databaseUrl}/${nodePath}.json`);
    return response.data ? Object.values(response.data) : [];
  } catch (err) {
    return [];
  }
}

async function deleteAppointment(email) {
  if (!email) return { success: false };
  const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nodePath = `firstoption_agency/${emailKey}`;

  if (adminApp) {
    try {
      await adminApp.database().ref(nodePath).remove();
      return { success: true };
    } catch (err) {}
  }
  try {
    await axios.delete(`${databaseUrl}/${nodePath}.json`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// -------------------------------------------------------------
// SCHEDULES (/firstoption_agency_schedules)
// -------------------------------------------------------------
async function saveSchedule(scheduleData) {
  if (!scheduleData || !scheduleData.id) scheduleData.id = 'sched_' + Date.now();
  const nodePath = `firstoption_agency_schedules/${scheduleData.id}`;
  const payload = { ...scheduleData, updated_at: new Date().toISOString() };

  if (adminApp) {
    try {
      await adminApp.database().ref(nodePath).set(payload);
      return { success: true };
    } catch (err) {}
  }
  try {
    await axios.put(`${databaseUrl}/${nodePath}.json`, payload);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getSchedules() {
  const nodePath = `firstoption_agency_schedules`;
  if (adminApp) {
    try {
      const snapshot = await adminApp.database().ref(nodePath).once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    } catch (err) {}
  }
  try {
    const response = await axios.get(`${databaseUrl}/${nodePath}.json`);
    return response.data ? Object.values(response.data) : [];
  } catch (err) {
    return [];
  }
}

async function deleteSchedule(schedId) {
  if (!schedId) return { success: false };
  const nodePath = `firstoption_agency_schedules/${schedId}`;
  if (adminApp) {
    try {
      await adminApp.database().ref(nodePath).remove();
      return { success: true };
    } catch (err) {}
  }
  try {
    await axios.delete(`${databaseUrl}/${nodePath}.json`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// -------------------------------------------------------------
// LOGS (/firstoption_agency_logs)
// -------------------------------------------------------------
async function saveMessageLog(logData) {
  const logId = logData.id || 'log_' + Date.now();
  const nodePath = `firstoption_agency_logs/${logId}`;
  const payload = { ...logData, created_at: new Date().toISOString() };

  if (adminApp) {
    try {
      await adminApp.database().ref(nodePath).set(payload);
      return { success: true };
    } catch (err) {}
  }
  try {
    await axios.put(`${databaseUrl}/${nodePath}.json`, payload);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getMessageLogs() {
  const nodePath = `firstoption_agency_logs`;
  if (adminApp) {
    try {
      const snapshot = await adminApp.database().ref(nodePath).once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    } catch (err) {}
  }
  try {
    const response = await axios.get(`${databaseUrl}/${nodePath}.json`);
    return response.data ? Object.values(response.data) : [];
  } catch (err) {
    return [];
  }
}

module.exports = {
  saveAppointment,
  getAppointments,
  deleteAppointment,
  saveSchedule,
  getSchedules,
  deleteSchedule,
  saveMessageLog,
  getMessageLogs
};
