const db = require('../db');
const firebaseService = require('./firebaseService');
const evolutionWhatsappService = require('./evolutionWhatsappService');

let schedulerTimer = null;

/**
 * Schedule a new WhatsApp message for a lead
 * 
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.phone
 * @param {string} params.lead_name
 * @param {string} params.form_type - 'half_form' or 'full_form'
 * @param {string} params.message_text
 * @param {string|Date} params.scheduled_at - Target ISO date string or Date object
 */
async function scheduleMessage({ email, phone, lead_name, form_type, message_text, scheduled_at }) {
  const targetDateStr = new Date(scheduled_at).toISOString();

  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO whatsapp_schedules (email, phone, lead_name, form_type, message_text, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    db.run(query, [
      email || 'N/A',
      phone || 'N/A',
      lead_name || 'Valdho Lead',
      form_type || 'half_form',
      message_text || '',
      targetDateStr
    ], function(err) {
      if (err) {
        console.error('[Scheduler Error] Failed to insert schedule in DB:', err.message);
        return reject(err);
      }

      const scheduleRecord = {
        id: this.lastID,
        email: email || 'N/A',
        phone: phone || 'N/A',
        lead_name: lead_name || 'Valdho Lead',
        form_type: form_type || 'half_form',
        message_text,
        scheduled_at: targetDateStr,
        status: 'pending',
        created_at: new Date().toISOString()
      };

      // Also save to Firebase under /firstoption_agency_schedules
      firebaseService.saveValdhoSchedule(scheduleRecord).catch(fbErr => {
        console.error('Firebase saveValdhoSchedule error:', fbErr);
      });

      console.log(`[Scheduler Success] Scheduled message ID ${scheduleRecord.id} for ${phone} at ${targetDateStr}`);
      resolve(scheduleRecord);
    });
  });
}

/**
 * Check DB for due pending scheduled messages and send them via Evolution API
 */
async function checkAndDispatchDueMessages() {
  const nowIso = new Date().toISOString();

  db.all(
    `SELECT * FROM whatsapp_schedules WHERE status = 'pending' AND datetime(scheduled_at) <= datetime(?)`,
    [nowIso],
    async (err, rows) => {
      if (err) {
        // Fallback ISO text comparison if SQLite datetime functions differ
        db.all(`SELECT * FROM whatsapp_schedules WHERE status = 'pending'`, [], async (err2, allRows) => {
          if (!err2 && allRows) {
            const due = allRows.filter(r => new Date(r.scheduled_at) <= new Date());
            for (const item of due) {
              await dispatchSingleMessage(item);
            }
          }
        });
        return;
      }

      if (rows && rows.length > 0) {
        console.log(`[Scheduler Worker] Found ${rows.length} due message(s) to send.`);
        for (const item of rows) {
          await dispatchSingleMessage(item);
        }
      }
    }
  );
}

/**
 * Helper to dispatch a single scheduled message
 */
async function dispatchSingleMessage(item) {
  console.log(`[Scheduler Dispatching] Message ID ${item.id} to ${item.phone}...`);
  
  const result = await evolutionWhatsappService.sendEvolutionWhatsApp(item.phone, item.message_text);

  const status = result.success ? 'sent' : 'failed';
  const error_message = result.success ? null : (typeof result.error === 'object' ? JSON.stringify(result.error) : String(result.error));
  const sent_at = result.success ? new Date().toISOString() : null;

  const updateQuery = `
    UPDATE whatsapp_schedules
    SET status = ?, error_message = ?, sent_at = ?
    WHERE id = ?
  `;

  db.run(updateQuery, [status, error_message, sent_at, item.id], (updateErr) => {
    if (updateErr) {
      console.error(`Failed to update schedule status for ID ${item.id}:`, updateErr.message);
    }
  });

  const updatedRecord = {
    ...item,
    status,
    error_message,
    sent_at,
    updated_at: new Date().toISOString()
  };

  firebaseService.saveValdhoSchedule(updatedRecord).catch(e => console.error(e));
}

/**
 * Cancel all pending scheduled messages for a given email / lead
 */
async function cancelSchedulesForEmail(email) {
  if (!email) return;

  db.all(`SELECT id FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?) AND status = 'pending'`, [email], (err, rows) => {
    if (!err && rows && rows.length > 0) {
      rows.forEach(r => {
        firebaseService.deleteValdhoSchedule(r.id).catch(e => console.error(e));
      });
    }

    db.run(
      `DELETE FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?)`,
      [email],
      (delErr) => {
        if (delErr) console.error(`Failed to cancel schedules for ${email}:`, delErr.message);
        else console.log(`[Scheduler] Cancelled all pending scheduled messages for ${email}`);
      }
    );
  });
}

/**
 * Cancel or delete a single scheduled message by ID
 */
async function cancelScheduleById(id) {
  if (!id) return;

  db.run(`DELETE FROM whatsapp_schedules WHERE id = ?`, [id], (err) => {
    if (err) console.error(`Failed to delete schedule ${id}:`, err.message);
    else console.log(`[Scheduler] Deleted schedule ID ${id}`);
  });

  firebaseService.deleteValdhoSchedule(id).catch(e => console.error(e));
}

/**
 * Start recurring background scheduler interval (runs every 30 seconds)
 */
function startScheduler(intervalMs = 30000) {
  if (schedulerTimer) return;

  console.log(`[Scheduler Engine] Started checking scheduled WhatsApp messages every ${intervalMs / 1000}s.`);
  checkAndDispatchDueMessages();
  schedulerTimer = setInterval(checkAndDispatchDueMessages, intervalMs);
}

module.exports = {
  scheduleMessage,
  checkAndDispatchDueMessages,
  cancelSchedulesForEmail,
  cancelScheduleById,
  startScheduler
};
