// Valdho Appointments & Evolution WhatsApp Dashboard Script
let valdhoAppointments = [];
let selectedLeadForWa = null;
let scheduledQueue = [];
let dispatchLogs = [];
let isAutomationPaused = false;

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

const TEMPLATES = {
  half: (name) => `*Dear ${name || 'Valdho Lead'},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`,
  full: (name, answers) => `*Dear ${name || 'Valdho Lead'},*\n\nYour appointment registration has been successfully received!\n\n*Details:* ${answers || 'Step 2 Completed'}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`
};

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

    valdhoAppointments = await res.json();

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
          <button class="btn" onclick="openWhatsAppModal('${email}')" style="background-color: #25d366; color: white; padding: 6px 12px; font-size: 13px; margin-right: 4px;">
            <i data-lucide="message-square" style="width: 14px; height: 14px;"></i>
            WhatsApp
          </button>
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
// SCHEDULED QUEUE & LOGS MODALS
// -------------------------------------------------------------
async function fetchScheduledQueue() {
  const queueBody = document.getElementById('queue-body');
  try {
    const res = await fetch('/api/valdho/whatsapp/schedules');
    scheduledQueue = await res.json();
    renderQueueTable();
  } catch (e) {
    if (queueBody) queueBody.innerHTML = `<tr><td colspan="6" class="empty-state">Error loading scheduled queue.</td></tr>`;
  }
}

function renderQueueTable() {
  const queueBody = document.getElementById('queue-body');
  if (!queueBody) return;

  if (scheduledQueue.length === 0) {
    queueBody.innerHTML = `<tr><td colspan="6" class="empty-state"><p>No scheduled WhatsApp messages in queue.</p></td></tr>`;
    return;
  }

  queueBody.innerHTML = scheduledQueue.map(item => {
    const isSent = item.status === 'sent';
    const statusBadge = isSent
      ? `<span class="badge badge-captured">Sent ✅</span>`
      : `<span class="badge badge-pending">Pending ⏳</span>`;

    const schedDate = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('en-IN') : '-';

    return `
      <tr>
        <td data-label="Lead / Contact"><strong>${item.lead_name || item.email}</strong></td>
        <td data-label="Phone">${item.phone}</td>
        <td data-label="Form Type"><span class="choice-pill">${item.form_type}</span></td>
        <td data-label="Target Scheduled Date">${schedDate}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Action" style="text-align: right;">
          <button class="btn btn-danger" onclick="deleteSchedule(${item.id})" style="padding: 4px 8px; font-size: 12px;">
            Cancel
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.deleteSchedule = async function(id) {
  if (!confirm(`Cancel scheduled WhatsApp message #${id}?`)) return;
  try {
    const res = await fetch('/api/valdho/whatsapp/schedules/' + id, { method: 'DELETE' });
    if (res.ok) fetchScheduledQueue();
  } catch (err) {}
};

async function fetchDispatchLogs() {
  const logsBody = document.getElementById('logs-body');
  try {
    const res = await fetch('/api/valdho/whatsapp/logs');
    dispatchLogs = await res.json();
    renderLogsTable();
  } catch (e) {
    if (logsBody) logsBody.innerHTML = `<tr><td colspan="5" class="empty-state">Error loading logs.</td></tr>`;
  }
}

function renderLogsTable() {
  const logsBody = document.getElementById('logs-body');
  if (!logsBody) return;

  if (dispatchLogs.length === 0) {
    logsBody.innerHTML = `<tr><td colspan="5" class="empty-state"><p>No message logs available yet.</p></td></tr>`;
    return;
  }

  logsBody.innerHTML = dispatchLogs.map(log => {
    const isSent = log.status === 'sent' || log.status === 'accepted';
    const statusBadge = isSent
      ? `<span class="badge badge-captured">Sent ✅</span>`
      : `<span class="badge badge-pending" style="background-color: #fde8e8; color: #9b1c1c;">Failed ❌</span>`;

    const date = log.received_at || log.sent_at || log.created_at
      ? new Date(log.received_at || log.sent_at || log.created_at).toLocaleString('en-IN')
      : '-';

    return `
      <tr>
        <td data-label="Recipient Phone"><strong>${log.recipient || log.phone || 'N/A'}</strong></td>
        <td data-label="Lead Reference">${log.payment_id || log.email || 'N/A'}</td>
        <td data-label="Message Content" style="max-width: 280px; word-break: break-word; font-size: 13px;">${log.message_text || log.raw_payload || '-'}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Timestamp">${date}</td>
      </tr>
    `;
  }).join('');
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
  if (isCompleted) messageInput.value = TEMPLATES.full(name, choicesSummary);
  else messageInput.value = TEMPLATES.half(name);

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
function closeQueueModal() { document.getElementById('modal-queue-backdrop').classList.remove('active'); }
function closeLogsModal() { document.getElementById('modal-logs-backdrop').classList.remove('active'); }
function closeIntegrationModal() { document.getElementById('modal-integration-backdrop').classList.remove('active'); }

// DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);

  safeAddListener('modal-whatsapp-close', 'click', closeWhatsAppModal);
  safeAddListener('btn-cancel-whatsapp', 'click', closeWhatsAppModal);

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

  safeAddListener('btn-toggle-automation', 'click', toggleAutomationEngine);
  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  safeAddListener('btn-tmpl-half', 'click', () => {
    if (selectedLeadForWa) document.getElementById('wa-message-text').value = TEMPLATES.half(selectedLeadForWa.name);
  });

  safeAddListener('btn-tmpl-full', 'click', () => {
    if (selectedLeadForWa) document.getElementById('wa-message-text').value = TEMPLATES.full(selectedLeadForWa.name, 'Step 2 Completed');
  });

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

  fetchValdhoAppointments();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchValdhoAppointments();
}
