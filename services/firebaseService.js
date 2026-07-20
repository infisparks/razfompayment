const axios = require('axios');

/**
 * Firebase Service for managing Valdho appointments and schedules.
 * Uses Firebase Realtime Database REST API using databaseURL:
 * https://billing4-44c05-default-rtdb.firebaseio.com
 */

const databaseUrl = (process.env.FIREBASE_DATABASE_URL || 'https://billing4-44c05-default-rtdb.firebaseio.com').replace(/\/$/, '');

/**
 * Save or update a Valdho appointment in Firebase under `/firstoption_agency/{emailKey}`
 */
async function saveValdhoAppointment(emailKey, appointmentData) {
  if (!emailKey) return { success: false, error: 'Missing email key' };

  const nodePath = `firstoption_agency/${emailKey}`;
  const payload = {
    ...appointmentData,
    updated_at: new Date().toISOString()
  };

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.put(targetUrl, payload, { timeout: 10000 });
    console.log(`[Firebase REST API] Valdho appointment ${emailKey} saved under /${nodePath}`);
    return { success: true };
  } catch (err) {
    console.error(`[Firebase REST Error] Failed to save appointment ${emailKey}:`, err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all Valdho appointments under `/firstoption_agency`
 */
async function getValdhoAppointments() {
  const nodePath = `firstoption_agency`;
  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    const response = await axios.get(targetUrl, { timeout: 10000 });
    const data = response.data;
    return data ? Object.values(data) : [];
  } catch (err) {
    console.error('[Firebase REST Error] Failed to fetch Valdho appointments:', err.message || err);
    return [];
  }
}

/**
 * Delete Valdho appointment from Firebase under `/firstoption_agency/{emailKey}`
 */
async function deleteValdhoAppointment(email) {
  if (!email) return { success: false, error: 'Missing email' };
  const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nodePath = `firstoption_agency/${emailKey}`;

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.delete(targetUrl, { timeout: 10000 });
    console.log(`[Firebase REST API] Deleted appointment under /${nodePath}`);
    return { success: true };
  } catch (err) {
    console.error(`[Firebase REST Error] Failed to delete appointment:`, err.message || err);
    return { success: false, error: err.message };
  }
}

async function saveValdhoSchedule() {
  return { success: true };
}

async function getValdhoSchedules() {
  return [];
}

async function deleteValdhoSchedule() {
  return { success: true };
}

/**
 * Save WhatsApp dispatch log to Firebase under `/firstoption_agency_logs/{logId}`
 */
async function saveWhatsAppLog(logData) {
  if (!logData || !logData.id) return { success: false, error: 'Missing log id' };

  const logId = logData.id;
  const nodePath = `firstoption_agency_logs/${logId}`;
  const payload = {
    ...logData,
    timestamp: new Date().toISOString()
  };

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.put(targetUrl, payload, { timeout: 10000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  saveValdhoAppointment,
  getValdhoAppointments,
  deleteValdhoAppointment,
  saveValdhoSchedule,
  getValdhoSchedules,
  deleteValdhoSchedule,
  saveWhatsAppLog
};
