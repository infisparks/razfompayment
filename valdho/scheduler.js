const db = require('../db');
const firebase = require('./firebase');
const whatsapp = require('./whatsapp');

let schedulerTimer = null;
let isPaused = false; // Automation Pause/Resume state

async function pauseAutomation() {
  isPaused = true;
  console.log('[Valdho Scheduler] Automation engine PAUSED ⏸️');
  await firebase.saveConfig('automation_status', { isPaused: true });
  return { isPaused: true };
}

async function resumeAutomation() {
  isPaused = false;
  console.log('[Valdho Scheduler] Automation engine RESUMED ▶️');
  await firebase.saveConfig('automation_status', { isPaused: false });
  checkAndDispatchDueMessages();
  return { isPaused: false };
}

function getAutomationStatus() {
  return { isPaused };
}

/**
 * Initialize scheduler state and restore pending schedules from Firebase on redeployment
 */
async function syncStateFromFirebase() {
  try {
    // 1. Restore Automation Pause/Resume status from Firebase
    const config = await firebase.getConfig('automation_status');
    if (config && typeof config.isPaused === 'boolean') {
      isPaused = config.isPaused;
      console.log(`[Valdho Scheduler] Restored automation status from Firebase: ${isPaused ? 'PAUSED ⏸️' : 'ACTIVE ▶️'}`);
    }

    // 2. Restore pending schedules from Firebase into SQLite
    const fbSchedules = await firebase.getSchedules();
    if (fbSchedules && fbSchedules.length > 0) {
      fbSchedules.forEach(sched => {
        if (sched && sched.phone && sched.scheduled_at) {
          const query = `
            INSERT INTO whatsapp_schedules (id, email, phone, lead_name, form_type, message_text, scheduled_at, status, created_at, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              sent_at = excluded.sent_at,
              error_message = excluded.error_message
          `;
          db.run(query, [
            sched.id,
            sched.email || 'N/A',
            sched.phone,
            sched.lead_name || 'Valdho Lead',
            sched.form_type || 'half_form',
            sched.message_text || '',
            sched.scheduled_at,
            sched.status || 'pending',
            sched.created_at || new Date().toISOString(),
            sched.sent_at || null
          ]);
        }
      });
      console.log(`[Valdho Scheduler] Synced ${fbSchedules.length} schedule(s) from Firebase.`);
    }
  } catch (err) {
    console.warn('[Valdho Scheduler] Firebase sync error during startup:', err.message);
  }
}

/**
 * Schedule a new message with flexible intervals (1m, 1h, 1d, 5d, 10d, or target date)
 */
async function scheduleMessage({ email, phone, lead_name, form_type, message_text, interval, scheduled_at }) {
  let targetDate = new Date();

  if (interval === '1m') {
    targetDate.setMinutes(targetDate.getMinutes() + 1);
  } else if (interval === '1h') {
    targetDate.setHours(targetDate.getHours() + 1);
  } else if (interval === '1d') {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (interval === '5d') {
    targetDate.setDate(targetDate.getDate() + 5);
  } else if (interval === '10d') {
    targetDate.setDate(targetDate.getDate() + 10);
  } else if (scheduled_at) {
    targetDate = new Date(scheduled_at);
  } else {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const targetDateStr = targetDate.toISOString();

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
        console.error('[Valdho Scheduler Error] Insert failed:', err.message);
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

      firebase.saveSchedule(scheduleRecord).catch(e => console.error(e));
      console.log(`[Valdho Scheduler] Scheduled ID ${scheduleRecord.id} for ${phone} at ${targetDateStr}`);
      resolve(scheduleRecord);
    });
  });
}

/**
 * Check DB for due pending scheduled messages and send them
 */
async function checkAndDispatchDueMessages() {
  if (isPaused) {
    console.log('[Valdho Scheduler] Check skipped: Automation engine is PAUSED ⏸️');
    return;
  }

  const nowIso = new Date().toISOString();

  db.all(
    `SELECT * FROM whatsapp_schedules WHERE status = 'pending' AND datetime(scheduled_at) <= datetime(?)`,
    [nowIso],
    async (err, rows) => {
      if (err) {
        db.all(`SELECT * FROM whatsapp_schedules WHERE status = 'pending'`, [], async (err2, allRows) => {
          if (!err2 && allRows) {
            const due = allRows.filter(r => new Date(r.scheduled_at) <= new Date());
            for (const item of due) {
              if (isPaused) break;
              await dispatchSingleMessage(item);
            }
          }
        });
        return;
      }

      if (rows && rows.length > 0) {
        console.log(`[Valdho Scheduler] Found ${rows.length} due message(s).`);
        for (const item of rows) {
          if (isPaused) break;
          await dispatchSingleMessage(item);
        }
      }
    }
  );
}

/**
 * Dispatch a single message and record execution logs
 */
async function dispatchSingleMessage(item) {
  console.log(`[Valdho Scheduler] Sending scheduled message ID ${item.id} to ${item.phone}...`);
  
  const result = await whatsapp.sendEvolutionWhatsApp(item.phone, item.message_text);

  const status = result.success ? 'sent' : 'failed';
  const error_message = result.success ? null : (typeof result.error === 'object' ? JSON.stringify(result.error) : String(result.error));
  const sent_at = result.success ? new Date().toISOString() : null;

  // 1. Update schedule status
  db.run(
    `UPDATE whatsapp_schedules SET status = ?, error_message = ?, sent_at = ? WHERE id = ?`,
    [status, error_message, sent_at, item.id],
    (err) => { if (err) console.error(err); }
  );

  const updatedSched = { ...item, status, error_message, sent_at, updated_at: new Date().toISOString() };
  firebase.saveSchedule(updatedSched).catch(e => console.error(e));

  // 2. Log message execution
  const logData = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    schedule_id: item.id,
    email: item.email,
    phone: item.phone,
    lead_name: item.lead_name,
    message_text: item.message_text,
    status: status,
    error_message: error_message,
    sent_at: sent_at || new Date().toISOString()
  };

  db.run(
    `INSERT INTO whatsapp_logs (message_id, recipient, payment_id, status, error_message, raw_payload) VALUES (?, ?, ?, ?, ?, ?)`,
    [logData.id, item.phone, item.email, status, error_message, JSON.stringify(result)]
  );

  firebase.saveMessageLog(logData).catch(e => console.error(e));
}

/**
 * Cancel schedules for a deleted lead
 */
async function cancelSchedulesForEmail(email) {
  if (!email) return;

  db.all(`SELECT id FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?) AND status = 'pending'`, [email], (err, rows) => {
    if (!err && rows && rows.length > 0) {
      rows.forEach(r => firebase.deleteSchedule(r.id).catch(e => console.error(e)));
    }

    db.run(`DELETE FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?)`, [email]);
  });
}

/**
 * Delete single schedule by ID
 */
async function cancelScheduleById(id) {
  if (!id) return;
  db.run(`DELETE FROM whatsapp_schedules WHERE id = ?`, [id]);
  firebase.deleteSchedule(id).catch(e => console.error(e));
}

/**
 * Start background scheduler engine (checks every 30s)
 */
async function startScheduler(intervalMs = 30000) {
  if (schedulerTimer) return;
  
  // Sync state and pending schedules from Firebase on startup
  await syncStateFromFirebase();

  console.log(`[Valdho Scheduler Engine] Running check every ${intervalMs / 1000}s.`);
  checkAndDispatchDueMessages();
  schedulerTimer = setInterval(checkAndDispatchDueMessages, intervalMs);
}

module.exports = {
  pauseAutomation,
  resumeAutomation,
  getAutomationStatus,
  scheduleMessage,
  checkAndDispatchDueMessages,
  cancelSchedulesForEmail,
  cancelScheduleById,
  startScheduler,
  syncStateFromFirebase
};
