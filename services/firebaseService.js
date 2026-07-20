const axios = require('axios');

/**
 * Single-Node Firebase Service: Manages strictly 1 single node: `/firstoption_agency`
 * Realtime Database URL: https://billing4-44c05-default-rtdb.firebaseio.com
 */

const databaseUrl = (process.env.FIREBASE_DATABASE_URL || 'https://billing4-44c05-default-rtdb.firebaseio.com').replace(/\/$/, '');

/**
 * Save or update a Valdho appointment under single node `/firstoption_agency/{emailKey}`
 */
async function saveValdhoAppointment(emailKey, appointmentData) {
  if (!emailKey) return { success: false, error: 'Missing email key' };

  const nodePath = `firstoption_agency/${emailKey}`;
  const payload = {
    ...appointmentData,
    updated_at: appointmentData.updated_at || new Date().toISOString()
  };

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.put(targetUrl, payload, { timeout: 10000 });
    console.log(`[Firebase Single Node] Saved ${emailKey} under /${nodePath}`);
    return { success: true };
  } catch (err) {
    console.error(`[Firebase Error] Failed to save appointment ${emailKey}:`, err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all appointments from single node `/firstoption_agency`
 */
async function getValdhoAppointments() {
  const nodePath = `firstoption_agency`;
  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    const response = await axios.get(targetUrl, { timeout: 10000 });
    const data = response.data;
    return data ? Object.values(data) : [];
  } catch (err) {
    console.error('[Firebase Error] Failed to fetch appointments:', err.message || err);
    return [];
  }
}

/**
 * Delete an appointment from single node `/firstoption_agency/{emailKey}`
 */
async function deleteValdhoAppointment(email) {
  if (!email) return { success: false, error: 'Missing email' };
  const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nodePath = `firstoption_agency/${emailKey}`;

  try {
    const targetUrl = `${databaseUrl}/${nodePath}.json`;
    await axios.delete(targetUrl, { timeout: 10000 });
    console.log(`[Firebase Single Node] Deleted appointment under /${nodePath}`);
    return { success: true };
  } catch (err) {
    console.error(`[Firebase Error] Failed to delete appointment:`, err.message || err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  saveValdhoAppointment,
  getValdhoAppointments,
  deleteValdhoAppointment
};
