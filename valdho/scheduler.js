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

const DEFAULT_AUTO_RULES = {
  half_enabled: true,
  half_interval: '5d',
  full_enabled: true,
  full_interval: '1m'
};

const DEFAULT_TEMPLATES = {
  half_template: `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`,
  full_template: `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`
};

/**
 * Automatically schedule follow-up message when a webhook is received
 */
async function autoScheduleLead(lead, formType) {
  if (!lead || !lead.email) return;

  const email = lead.email;
  const phone = lead.phone || 'N/A';
  const name = lead.name || 'Valdho Lead';

  // 1. Fetch Auto Rules from Firebase
  let rules = DEFAULT_AUTO_RULES;
  try {
    const savedRules = await firebase.getConfig('auto_rules');
    if (savedRules) rules = { ...DEFAULT_AUTO_RULES, ...savedRules };
  } catch (e) {}

  // 2. Fetch Templates from Firebase
  let templates = DEFAULT_TEMPLATES;
  try {
    const savedTemplates = await firebase.getConfig('templates');
    if (savedTemplates) templates = { ...DEFAULT_TEMPLATES, ...savedTemplates };
  } catch (e) {}

  // 3. If Step 2 (Full Form) is received, CANCEL all pending Half Form messages immediately!
  if (formType === 'full_form' || lead.status === 'completed') {
    console.log(`[Auto Scheduler] Lead ${email} completed Step 2. Canceling all pending Half Form scheduled messages!`);
    await cancelSchedulesForEmail(email);

    if (rules.full_enabled) {
      const choices = [];
      const allData = typeof lead.all_form_data === 'string' ? JSON.parse(lead.all_form_data) : (lead.all_form_data || {});
      Object.keys(allData).forEach(k => { if (Array.isArray(allData[k])) choices.push(...allData[k]); });
      
      const msgText = templates.full_template.replace(/\{name\}/g, name).replace(/\{answers\}/g, choices.join(', ') || 'Step 2 Completed');

      if (rules.full_interval === 'now') {
        whatsapp.sendEvolutionWhatsApp(phone, msgText).catch(e => console.error(e));
      } else {
        await scheduleMessage({
          email,
          phone,
          lead_name: name,
          form_type: 'full_form',
          message_text: msgText,
          interval: rules.full_interval || '1m'
        });
      }
    }
    return;
  }

  // 4. If Step 1 (Half Form) is received
  if (formType === 'half_form' && rules.half_enabled) {
    const msgText = templates.half_template.replace(/\{name\}/g, name);
    await scheduleMessage({
      email,
      phone,
      lead_name: name,
      form_type: 'half_form',
      message_text: msgText,
      interval: rules.half_interval || '5d'
    });
  }
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
      let dueList = rows || [];
      if (err || !rows) {
        await new Promise((resolve) => {
          db.all(`SELECT * FROM whatsapp_schedules WHERE status = 'pending'`, [], (err2, allRows) => {
            if (!err2 && allRows) {
              dueList = allRows.filter(r => new Date(r.scheduled_at) <= new Date());
            }
            resolve();
          });
        });
      }

      if (dueList && dueList.length > 0) {
        console.log(`[Valdho Scheduler] Found ${dueList.length} due message(s).`);
        for (const item of dueList) {
          if (isPaused) break;

          // PRE-DISPATCH SAFETY CHECK: If this is a Half Form message, check if lead completed Step 2 in the meantime!
          if (item.form_type === 'half_form' && item.email) {
            const leadRow = await new Promise((res) => {
              db.get('SELECT status, step2_data FROM valdho_appointments WHERE LOWER(email) = LOWER(?)', [item.email], (e, r) => res(r));
            });

            let hasStep2 = false;
            if (leadRow) {
              try {
                const s2 = typeof leadRow.step2_data === 'string' ? JSON.parse(leadRow.step2_data) : (leadRow.step2_data || {});
                if (Object.keys(s2).length > 0) hasStep2 = true;
              } catch(e){}
              if (leadRow.status === 'completed') hasStep2 = true;
            }

            if (hasStep2) {
              console.log(`[Scheduler Safety] Lead ${item.email} completed Full Form! Canceling Half Form message ID ${item.id}.`);
              cancelScheduleById(item.id);
              continue; // DO NOT SEND HALF FORM MESSAGE!
            }
          }

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
  autoScheduleLead,
  checkAndDispatchDueMessages,
  cancelSchedulesForEmail,
  cancelScheduleById,
  startScheduler,
  syncStateFromFirebase
};
