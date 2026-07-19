// Valdho Appointments & Evolution WhatsApp Dashboard Script
let valdhoAppointments = [];
let selectedLeadForWa = null;
let scheduledQueue = [];
let dispatchLogs = [];
let isAutomationPaused = false;
let countdownTimerInterval = null;

// Default Template fallback
let currentTemplates = {
  half_template: `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`,
  full_template: `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`
};

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// -------------------------------------------------------------
// TEMPLATES (PERSISTED IN FIREBASE /firstoption_agency_config/templates)
// -------------------------------------------------------------
async function fetchTemplates() {
  try {
    const res = await fetch('/api/valdho/templates');
    if (res.ok) {
      const data = await res.json();
      if (data && (data.half_template || data.full_template)) {
        currentTemplates = { ...currentTemplates, ...data };
      }
    }
  } catch (e) {
    console.warn('Error loading templates:', e);
  }
}

// -------------------------------------------------------------
// APPOINTMENTS
// -------------------------------------------------------------
async function fetchValdhoAppointments() {
  const valdhoBody = document.getElementById('valdho-body');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const res = await fetch('/api/valdho/appointments');
    if (!res.ok) throw new Error('Failed to fetch Valdho appointments');

    const data = await res.json();
    valdhoAppointments = Array.isArray(data) ? data : [];

    if (statusDot) {
      statusDot.style.backgroundColor = '#10b981';
      statusDot.style.boxShadow = '0 0 8px #10b981';
    }
    if (statusText) statusText.textContent = 'Server Active';

    renderValdhoTable();
    updateValdhoStats();
    checkAutomationStatus();
  } catch (error) {
    console.error('Error fetching appointments:', error);
    if (statusDot) {
      statusDot.style.backgroundColor = '#ef4444';
      statusDot.style.boxShadow = '0 0 8px #ef4444';
    }
    if (statusText) statusText.textContent = 'Server Disconnected';

    if (valdhoBody) {
      valdhoBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state" style="color: #ef4444;">
            <i data-lucide="alert-triangle" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
            <p>Error loading Valdho appointment data.</p>
          </td>
        </tr>
      `;
    }
    if (window.lucide) lucide.createIcons();
  }
}

function renderValdhoTable() {
  const valdhoBody = document.getElementById('valdho-body');
  if (!valdhoBody) return;

  if (valdhoAppointments.length === 0) {
    valdhoBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i data-lucide="folder-open" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>No appointments in <strong>firstoption_agency</strong> node yet. Submit a Valdho form to test live webhook storage.</p>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  valdhoBody.innerHTML = valdhoAppointments.map(app => {
    let allData = {};
    let step2Data = {};
    let step1Data = {};

    try { allData = typeof app.all_form_data === 'string' ? JSON.parse(app.all_form_data) : (app.all_form_data || {}); } catch (e) {}
    try { step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {}); } catch (e) {}
    try { step1Data = typeof app.step1_data === 'string' ? JSON.parse(app.step1_data) : (app.step1_data || {}); } catch (e) {}

    const hasStep2Data = Object.keys(step2Data).length > 0;
    const isCompleted = app.status === 'completed' || hasStep2Data;

    const choices = [];
    const targetSource = hasStep2Data ? step2Data : allData;

    Object.keys(targetSource).forEach(key => {
      const val = targetSource[key];
      if (Array.isArray(val)) choices.push(...val);
      else if (typeof val === 'string' && !key.toLowerCase().includes('email') && !key.toLowerCase().includes('name') && !key.toLowerCase().includes('phone')) {
        choices.push(val);
      }
    });

    const choicesHtml = choices.length > 0
      ? choices.map(c => `<span class="choice-pill">${c}</span>`).join('')
      : '<em style="color: #d97706; font-size: 13px; font-weight: 500;">⚠️ Step 2 Pending...</em>';

    const statusBadge = isCompleted
      ? `<span class="badge badge-captured">Full Form (Completed)</span>`
      : `<span class="badge badge-pending">Half Form (Step 1 Only)</span>`;

    const name = app.name || step1Data['First Name'] || 'Valdho Lead';
    const email = app.email || step1Data['Email'] || 'N/A';
    const phone = app.phone || step1Data['Phone Number'] || 'N/A';
    const updatedDate = app.updated_at || app.created_at ? new Date(app.updated_at || app.created_at).toLocaleString('en-IN') : '-';

    return `
      <tr>
        <td data-label="Lead / Contact">
          <div class="payer-info">
            <strong style="color: #111827; font-size: 15px;">${name}</strong>
            <span class="payer-email">${email}</span>
          </div>
        </td>
        <td data-label="Phone Number"><strong>${phone}</strong></td>
        <td data-label="Form Selections / Answers">${choicesHtml}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Last Submission">${updatedDate}</td>
        <td data-label="Actions" style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary" onclick="openValdhoDetails('${email}')" style="padding: 6px 12px; font-size: 13px; margin-right: 4px;">
            Inspect
          </button>
          <button class="btn btn-danger" onclick="deleteAppointment('${email}', '${name.replace(/'/g, "\\'")}')" style="padding: 6px 12px; font-size: 13px;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function updateValdhoStats() {
  const total = valdhoAppointments.length;
  let completed = 0;
  let step1 = 0;

  valdhoAppointments.forEach(app => {
    let step2Data = {};
    try { step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {}); } catch (e) {}
    if (app.status === 'completed' || Object.keys(step2Data).length > 0) completed++;
    else step1++;
  });

  const statTotal = document.getElementById('stat-valdho-total');
  const statCompleted = document.getElementById('stat-valdho-completed');
  const statStep1 = document.getElementById('stat-valdho-step1');

  if (statTotal) statTotal.textContent = total;
  if (statCompleted) statCompleted.textContent = completed;
  if (statStep1) statStep1.textContent = step1;
}

// Delete Appointment (Deletes lead + cancels all scheduled messages)
window.deleteAppointment = async function(email, name) {
  if (!confirm(`Are you sure you want to delete appointment for "${name}" (${email})?\n\nThis will also CANCEL and DELETE all pending scheduled WhatsApp follow-up messages so no message will be sent to this lead.`)) {
    return;
  }

  try {
    const res = await fetch('/api/valdho/appointments/' + encodeURIComponent(email), {
      method: 'DELETE'
    });

    if (res.ok) {
      alert(`Appointment for ${name} deleted and all scheduled WhatsApp messages canceled!`);
      fetchValdhoAppointments();
    } else {
      const data = await res.json();
      alert(`Error deleting appointment: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Failed to delete appointment: ${err.message}`);
  }
};

// -------------------------------------------------------------
// AUTOMATION PAUSE & RESUME CONTROLS
// -------------------------------------------------------------
async function checkAutomationStatus() {
  try {
    const res = await fetch('/api/valdho/automation/status');
    const data = await res.json();
    isAutomationPaused = data.isPaused;
    updateAutomationUI();
  } catch (e) {}
}

async function toggleAutomationEngine() {
  const targetEndpoint = isAutomationPaused ? '/api/valdho/automation/resume' : '/api/valdho/automation/pause';
  try {
    const res = await fetch(targetEndpoint, { method: 'POST' });
    const data = await res.json();
    isAutomationPaused = data.isPaused;
    updateAutomationUI();
    alert(`Automation Engine is now ${isAutomationPaused ? 'PAUSED ⏸️' : 'ACTIVE ▶️'}`);
  } catch (err) {
    alert(`Error toggling automation state: ${err.message}`);
  }
}

function updateAutomationUI() {
  const btnToggle = document.getElementById('btn-toggle-automation');
  const textToggle = document.getElementById('text-toggle-automation');
  const iconToggle = document.getElementById('icon-toggle-automation');
  const statEngineStatus = document.getElementById('stat-engine-status');

  if (isAutomationPaused) {
    if (btnToggle) btnToggle.style.backgroundColor = '#059669';
    if (textToggle) textToggle.textContent = 'Resume Automation';
    if (statEngineStatus) {
      statEngineStatus.textContent = '⏸️ Paused';
      statEngineStatus.style.color = '#d97706';
    }
  } else {
    if (btnToggle) btnToggle.style.backgroundColor = '#d97706';
    if (textToggle) textToggle.textContent = 'Pause Automation';
    if (statEngineStatus) {
      statEngineStatus.textContent = '▶️ Active';
      statEngineStatus.style.color = '#10b981';
    }
  }
  if (window.lucide) lucide.createIcons();
}

// -------------------------------------------------------------
// COUNTDOWN TIMER CALCULATOR
// -------------------------------------------------------------
function getCountdownText(targetIso, isSent) {
  if (isSent) return `<span class="badge badge-captured">Completed ✅</span>`;
  if (!targetIso) return '-';

  const diffMs = new Date(targetIso).getTime() - Date.now();

  if (diffMs <= 0) {
    return `<span class="badge" style="background-color: #ef4444; color: white;">⚡ Due Now / Sending...</span>`;
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  let str = '';
  if (days > 0) str += `${days}d `;
  if (hours > 0 || days > 0) str += `${hours}h `;
  if (mins > 0 || hours > 0 || days > 0) str += `${mins}m `;
  str += `${secs}s`;

  return `<span class="badge" style="background-color: #e0e7ff; color: #3730a3; font-family: monospace; font-size: 12px;">⏳ in ${str}</span>`;
}

function startCountdownTicker() {
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  countdownTimerInterval = setInterval(() => {
    if (scheduledQueue && scheduledQueue.length > 0) {
      scheduledQueue.forEach(item => {
        const el = document.getElementById(`countdown-${item.id}`);
        if (el) {
          el.innerHTML = getCountdownText(item.scheduled_at, item.status === 'sent');
        }
      });
    }
  }, 1000);
}

// -------------------------------------------------------------
// SCHEDULED QUEUE MODAL
// -------------------------------------------------------------
async function fetchScheduledQueue() {
  const queueBody = document.getElementById('queue-body');
  try {
    const res = await fetch('/api/valdho/whatsapp/schedules');
    if (!res.ok) throw new Error('Failed to fetch schedules');

    const data = await res.json();
    scheduledQueue = Array.isArray(data) ? data : (typeof data === 'object' && data !== null ? Object.values(data) : []);
    renderQueueTable();
    startCountdownTicker();
  } catch (e) {
    console.error('Error fetching scheduled queue:', e);
    if (queueBody) queueBody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color: #ef4444;">Failed to load scheduled queue.</td></tr>`;
  }
}

function renderQueueTable() {
  const queueBody = document.getElementById('queue-body');
  if (!queueBody) return;

  if (scheduledQueue.length === 0) {
    queueBody.innerHTML = `<tr><td colspan="7" class="empty-state"><p>No scheduled WhatsApp messages in queue.</p></td></tr>`;
    return;
  }

  queueBody.innerHTML = scheduledQueue.map(item => {
    const isSent = item.status === 'sent';
    const statusBadge = isSent
      ? `<span class="badge badge-captured">Sent ✅</span>`
      : `<span class="badge badge-pending">Pending ⏳</span>`;

    const schedDate = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('en-IN') : '-';
    const countdownHtml = getCountdownText(item.scheduled_at, isSent);

    return `
      <tr>
        <td data-label="Lead / Contact"><strong>${item.lead_name || item.email}</strong></td>
        <td data-label="Phone">${item.phone}</td>
        <td data-label="Form Type"><span class="choice-pill">${item.form_type}</span></td>
        <td data-label="Target Scheduled Date">${schedDate}</td>
        <td data-label="Time Remaining" id="countdown-${item.id}">${countdownHtml}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Action" style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary" onclick="openEditScheduleModal(${item.id})" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;">
            <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i> Edit
          </button>
          <button class="btn btn-danger" onclick="deleteSchedule(${item.id})" style="padding: 4px 8px; font-size: 12px;">
            Cancel
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

window.deleteSchedule = async function(id) {
  if (!confirm(`Cancel scheduled WhatsApp message #${id}?`)) return;
  try {
    const res = await fetch('/api/valdho/whatsapp/schedules/' + id, { method: 'DELETE' });
    if (res.ok) fetchScheduledQueue();
  } catch (err) {}
};

window.openEditScheduleModal = function(id) {
  const item = scheduledQueue.find(s => String(s.id) === String(id));
  if (!item) return;

  document.getElementById('edit-sched-id').value = item.id;
  document.getElementById('edit-sched-lead').value = `${item.lead_name || 'Lead'} (${item.phone})`;
  document.getElementById('edit-sched-text').value = item.message_text || '';

  if (item.scheduled_at) {
    const d = new Date(item.scheduled_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('edit-sched-date').value = d.toISOString().slice(0, 16);
  }

  document.getElementById('modal-edit-sched-backdrop').classList.add('active');
};

// -------------------------------------------------------------
// MESSAGE DISPATCH LOGS MODAL (WITH READ MORE / READ LESS)
// -------------------------------------------------------------
let expandedLogsMap = {};

async function fetchDispatchLogs() {
  const logsBody = document.getElementById('logs-body');
  try {
    const res = await fetch('/api/valdho/whatsapp/logs');
    const data = await res.json();
    dispatchLogs = Array.isArray(data) ? data : (typeof data === 'object' && data !== null ? Object.values(data) : []);
    renderLogsTable();
  } catch (e) {
    if (logsBody) logsBody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color: #ef4444;">Error loading logs.</td></tr>`;
  }
}

window.toggleLogMessage = function(logId) {
  expandedLogsMap[logId] = !expandedLogsMap[logId];
  renderLogsTable();
};

function renderLogsTable() {
  const logsBody = document.getElementById('logs-body');
  if (!logsBody) return;

  if (dispatchLogs.length === 0) {
    logsBody.innerHTML = `<tr><td colspan="5" class="empty-state"><p>No message logs available yet.</p></td></tr>`;
    return;
  }

  logsBody.innerHTML = dispatchLogs.map((log, index) => {
    const logId = log.id || `log_${index}`;
    const isSent = log.status === 'sent' || log.status === 'accepted';
    const statusBadge = isSent
      ? `<span class="badge badge-captured">Sent ✅</span>`
      : `<span class="badge badge-pending" style="background-color: #fde8e8; color: #9b1c1c;">Failed ❌</span>`;

    const date = log.received_at || log.sent_at || log.created_at
      ? new Date(log.received_at || log.sent_at || log.created_at).toLocaleString('en-IN')
      : '-';

    const rawMsg = log.message_text || log.raw_payload || '-';
    const isLong = rawMsg.length > 70;
    const isExpanded = !!expandedLogsMap[logId];

    let msgHtml = '';
    if (isLong) {
      if (isExpanded) {
        msgHtml = `
          <div style="white-space: pre-wrap; font-size: 13px; color: #1e293b;">${rawMsg}</div>
          <button onclick="toggleLogMessage('${logId}')" style="background: none; border: none; color: #6366f1; cursor: pointer; font-size: 12px; font-weight: 600; margin-top: 4px;">
            Show Less ▴
          </button>
        `;
      } else {
        const snippet = rawMsg.substring(0, 70);
        msgHtml = `
          <div style="font-size: 13px; color: #475569;">${snippet}...</div>
          <button onclick="toggleLogMessage('${logId}')" style="background: none; border: none; color: #6366f1; cursor: pointer; font-size: 12px; font-weight: 600; margin-top: 2px;">
            Read More ▾
          </button>
        `;
      }
    } else {
      msgHtml = `<div style="white-space: pre-wrap; font-size: 13px;">${rawMsg}</div>`;
    }

    return `
      <tr>
        <td data-label="Recipient Phone"><strong>${log.recipient || log.phone || 'N/A'}</strong></td>
        <td data-label="Lead Reference">${log.payment_id || log.email || 'N/A'}</td>
        <td data-label="Message Content" style="max-width: 320px;">${msgHtml}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Timestamp" style="white-space: nowrap; font-size: 13px; color: #64748b;">${date}</td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// -------------------------------------------------------------
// WHATSAPP SENDER & SCHEDULER MODAL
// -------------------------------------------------------------
window.openWhatsAppModal = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  selectedLeadForWa = app;

  let step2Data = {};
  try { step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {}); } catch (e) {}

  const isCompleted = app.status === 'completed' || Object.keys(step2Data).length > 0;
  const name = app.name || 'Valdho Lead';
  const phone = app.phone || 'N/A';
  const formTypeStr = isCompleted ? 'Full Form (Completed)' : 'Half Form (Step 1 Only)';

  document.getElementById('wa-lead-name').textContent = name;
  document.getElementById('wa-lead-phone').textContent = phone;
  document.getElementById('wa-lead-email').textContent = app.email || 'N/A';
  document.getElementById('wa-lead-type').textContent = formTypeStr;

  const choices = [];
  const allData = typeof app.all_form_data === 'string' ? JSON.parse(app.all_form_data) : (app.all_form_data || {});
  Object.keys(allData).forEach(k => {
    if (Array.isArray(allData[k])) choices.push(...allData[k]);
  });
  const choicesSummary = choices.join(', ');

  const messageInput = document.getElementById('wa-message-text');
  if (isCompleted) {
    messageInput.value = currentTemplates.full_template.replace(/\{name\}/g, name).replace(/\{answers\}/g, choicesSummary || 'Step 2 Completed');
  } else {
    messageInput.value = currentTemplates.half_template.replace(/\{name\}/g, name);
  }

  document.getElementById('modal-whatsapp-backdrop').classList.add('active');
};

window.openValdhoDetails = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  const isCompleted = app.status === 'completed';
  document.getElementById('modal-title').textContent = `Valdho Lead: ${app.name || app.email}`;
  document.getElementById('modal-pay-id').textContent = app.email;
  document.getElementById('modal-pay-status').innerHTML = isCompleted
    ? `<span class="badge badge-captured">Full Form (Completed)</span>`
    : `<span class="badge badge-pending">Half Form (Step 1 Only)</span>`;
  document.getElementById('modal-pay-email').textContent = app.email;
  document.getElementById('modal-pay-phone').textContent = app.phone || 'N/A';
  document.getElementById('modal-pay-date').textContent = app.updated_at ? new Date(app.updated_at).toLocaleString('en-IN') : '-';
  document.getElementById('modal-raw-payload').textContent = JSON.stringify(app, null, 2);

  document.getElementById('modal-backdrop').classList.add('active');
};

// Modal Close Helpers
function closeModal() { document.getElementById('modal-backdrop').classList.remove('active'); }
function closeWhatsAppModal() { document.getElementById('modal-whatsapp-backdrop').classList.remove('active'); }
function closeQueueModal() {
  document.getElementById('modal-queue-backdrop').classList.remove('active');
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
}
function closeWorkflowDrawer() {
  const backdrop = document.getElementById('drawer-workflow-backdrop');
  if (backdrop) backdrop.classList.remove('active');
}

window.openWorkflowDrawer = function() {
  const backdrop = document.getElementById('drawer-workflow-backdrop');
  if (backdrop) {
    backdrop.classList.add('active');
  }
  fetchGlobalWorkflow();
};

async function fetchGlobalWorkflow() {
  const defaultHalfMsg = `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`;
  const defaultFullMsg = `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`;

  try {
    const res = await fetch('/api/valdho/global-workflow');
    if (res.ok) {
      const wf = await res.json();
      if (document.getElementById('wf-half-enabled')) document.getElementById('wf-half-enabled').checked = wf.half_enabled !== false;
      if (document.getElementById('wf-half-interval')) document.getElementById('wf-half-interval').value = wf.half_interval || '5d';
      if (document.getElementById('wf-half-message')) document.getElementById('wf-half-message').value = wf.half_message || defaultHalfMsg;

      if (document.getElementById('wf-full-enabled')) document.getElementById('wf-full-enabled').checked = wf.full_enabled !== false;
      if (document.getElementById('wf-full-interval')) document.getElementById('wf-full-interval').value = wf.full_interval || '1m';
      if (document.getElementById('wf-full-message')) document.getElementById('wf-full-message').value = wf.full_message || defaultFullMsg;
    }
  } catch (e) {
    if (document.getElementById('wf-half-message')) document.getElementById('wf-half-message').value = defaultHalfMsg;
    if (document.getElementById('wf-full-message')) document.getElementById('wf-full-message').value = defaultFullMsg;
  }
}

// DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);

  safeAddListener('btn-open-scheduled-modal', 'click', () => {
    document.getElementById('modal-queue-backdrop').classList.add('active');
    fetchScheduledQueue();
  });
  safeAddListener('modal-queue-close', 'click', closeQueueModal);
  safeAddListener('btn-close-queue', 'click', closeQueueModal);

  safeAddListener('btn-open-logs-modal', 'click', () => {
    document.getElementById('modal-logs-backdrop').classList.add('active');
    fetchDispatchLogs();
  });
  safeAddListener('modal-logs-close', 'click', closeLogsModal);
  safeAddListener('btn-close-logs', 'click', closeLogsModal);

  safeAddListener('btn-open-workflow-modal', 'click', openWorkflowDrawer);
  safeAddListener('drawer-workflow-close', 'click', closeWorkflowDrawer);
  safeAddListener('btn-cancel-workflow', 'click', closeWorkflowDrawer);

  safeAddListener('modal-edit-sched-close', 'click', closeEditSchedModal);
  safeAddListener('btn-cancel-edit-sched', 'click', closeEditSchedModal);

  safeAddListener('btn-toggle-automation', 'click', toggleAutomationEngine);
  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  // Global Workflow Form Submit
  const formWorkflow = document.getElementById('form-global-workflow');
  if (formWorkflow) {
    formWorkflow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const half_enabled = document.getElementById('wf-half-enabled').checked;
      const half_interval = document.getElementById('wf-half-interval').value;
      const half_message = document.getElementById('wf-half-message').value;

      const full_enabled = document.getElementById('wf-full-enabled').checked;
      const full_interval = document.getElementById('wf-full-interval').value;
      const full_message = document.getElementById('wf-full-message').value;

      try {
        const res = await fetch('/api/valdho/global-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            half_enabled,
            half_interval,
            half_message,
            full_enabled,
            full_interval,
            full_message
          })
        });
        if (res.ok) {
          alert('Global Automation Workflow successfully saved to Firebase!');
          closeWorkflowDrawer();
        } else {
          alert('Failed to save global workflow.');
        }
      } catch (err) {
        alert(`Error saving global workflow: ${err.message}`);
      }
    });
  }

  // Save Templates Form Submission
  const formTemplates = document.getElementById('form-templates');
  if (formTemplates) {
    formTemplates.addEventListener('submit', async (e) => {
      e.preventDefault();
      const half_template = document.getElementById('tmpl-half-text').value;
      const full_template = document.getElementById('tmpl-full-text').value;

      try {
        const res = await fetch('/api/valdho/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ half_template, full_template })
        });
        if (res.ok) {
          currentTemplates = { half_template, full_template };
          alert('WhatsApp message templates successfully saved to Firebase!');
          closeTemplatesModal();
        } else {
          alert('Failed to save templates.');
        }
      } catch (err) {
        alert(`Error saving templates: ${err.message}`);
      }
    });
  }

  // Edit Schedule Form Submission
  const formEditSched = document.getElementById('form-edit-sched');
  if (formEditSched) {
    formEditSched.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-sched-id').value;
      const message_text = document.getElementById('edit-sched-text').value;
      const scheduled_at = document.getElementById('edit-sched-date').value;

      try {
        const res = await fetch('/api/valdho/whatsapp/schedules/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_text, scheduled_at })
        });
        if (res.ok) {
          alert(`Scheduled message #${id} updated successfully!`);
          closeEditSchedModal();
          fetchScheduledQueue();
        } else {
          alert('Failed to update schedule.');
        }
      } catch (err) {
        alert(`Error updating schedule: ${err.message}`);
      }
    });
  }

  const modeSelect = document.getElementById('wa-schedule-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const customGroup = document.getElementById('group-custom-date');
      if (customGroup) customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
  }

  const formWa = document.getElementById('form-whatsapp');
  if (formWa) {
    formWa.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedLeadForWa) return;

      const messageText = document.getElementById('wa-message-text').value;
      const scheduleMode = document.getElementById('wa-schedule-mode').value;
      const customDateVal = document.getElementById('wa-custom-date').value;

      let isCompleted = selectedLeadForWa.status === 'completed';
      const formType = isCompleted ? 'full_form' : 'half_form';

      if (scheduleMode === 'now') {
        try {
          const res = await fetch('/api/valdho/whatsapp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: selectedLeadForWa.email,
              phone: selectedLeadForWa.phone,
              text: messageText
            })
          });
          const data = await res.json();
          if (data.success) alert(`WhatsApp message sent successfully to ${selectedLeadForWa.phone}!`);
          else alert(`Result: ${JSON.stringify(data)}`);
        } catch (err) { alert(`Error: ${err.message}`); }
      } else {
        let interval = null;
        let scheduled_at = null;

        if (['1m', '1h', '1d', '5d', '10d'].includes(scheduleMode)) interval = scheduleMode;
        else if (scheduleMode === 'custom') scheduled_at = customDateVal;

        try {
          const res = await fetch('/api/valdho/whatsapp/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: selectedLeadForWa.email,
              phone: selectedLeadForWa.phone,
              lead_name: selectedLeadForWa.name,
              form_type: formType,
              message_text: messageText,
              interval,
              scheduled_at
            })
          });
          const data = await res.json();
          alert(`WhatsApp message scheduled successfully!`);
        } catch (err) { alert(`Error scheduling message: ${err.message}`); }
      }
      closeWhatsAppModal();
    });
  }

  safeAddListener('btn-open-integration-modal', 'click', () => {
    document.getElementById('modal-integration-backdrop').classList.add('active');
  });
  safeAddListener('modal-integration-close', 'click', closeIntegrationModal);
  safeAddListener('btn-cancel-integration', 'click', closeIntegrationModal);

  fetchTemplates();
  fetchValdhoAppointments();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchTemplates();
  fetchValdhoAppointments();
}
