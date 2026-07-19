// Valdho appointments & Evolution WhatsApp management script
let valdhoAppointments = [];
let selectedLeadForWa = null;
let scheduledQueue = [];

// Safe DOM event listener helper
function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  }
}

// Default Message Templates
const TEMPLATES = {
  half: (name) => `*Dear ${name || 'Valdho Lead'},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`,
  full: (name, answers) => `*Dear ${name || 'Valdho Lead'},*\n\nYour appointment registration has been successfully received!\n\n*Details:* ${answers || 'Step 2 Completed'}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`
};

// Fetch Valdho Appointments from API
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
  } catch (error) {
    console.error('Error fetching Valdho appointments:', error);
    
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

// Render Valdho Appointments Table with Delete & WhatsApp Action Buttons
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

    try {
      allData = typeof app.all_form_data === 'string' ? JSON.parse(app.all_form_data) : (app.all_form_data || {});
    } catch (e) { allData = app.all_form_data || {}; }

    try {
      step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {});
    } catch (e) { step2Data = app.step2_data || {}; }

    try {
      step1Data = typeof app.step1_data === 'string' ? JSON.parse(app.step1_data) : (app.step1_data || {});
    } catch (e) { step1Data = app.step1_data || {}; }

    const hasStep2Data = Object.keys(step2Data).length > 0;
    const isCompleted = app.status === 'completed' || hasStep2Data;

    const choices = [];
    const targetSource = hasStep2Data ? step2Data : allData;

    Object.keys(targetSource).forEach(key => {
      const val = targetSource[key];
      if (Array.isArray(val)) {
        choices.push(...val);
      } else if (typeof val === 'string' && !key.toLowerCase().includes('email') && !key.toLowerCase().includes('name') && !key.toLowerCase().includes('phone')) {
        choices.push(val);
      }
    });

    const choicesHtml = choices.length > 0
      ? choices.map(c => `<span class="choice-pill">${c}</span>`).join('')
      : '<em style="color: #d97706; font-size: 13px; font-weight: 500;">⚠️ Step 2 Pending...</em>';

    const statusBadge = isCompleted
      ? `<span class="badge badge-captured" style="background-color: #def7ec; color: #03543f; font-weight: 600;">Full Form (Completed)</span>`
      : `<span class="badge badge-pending" style="background-color: #fef3c7; color: #92400e; font-weight: 600;">Half Form (Step 1 Only)</span>`;

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
          <button class="btn" onclick="deleteAppointment('${email}', '${name.replace(/'/g, "\\'")}')" style="background-color: #ef4444; color: white; padding: 6px 10px; font-size: 13px;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Delete Appointment (removes lead + cancels all scheduled messages for that lead)
window.deleteAppointment = async function(email, name) {
  if (!confirm(`Are you sure you want to delete appointment for "${name}" (${email})?\n\nThis will also CANCEL and DELETE all scheduled WhatsApp follow-up messages so no message will be sent to this lead.`)) {
    return;
  }

  try {
    const res = await fetch('/api/valdho/appointments/' + encodeURIComponent(email), {
      method: 'DELETE'
    });

    const data = await res.json();
    if (res.ok) {
      alert(`Appointment for ${name} deleted and all scheduled WhatsApp messages canceled!`);
      fetchValdhoAppointments();
    } else {
      alert(`Error deleting appointment: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Failed to delete appointment:', err);
    alert(`Failed to delete appointment: ${err.message}`);
  }
};

// Delete Single Scheduled Message by ID
window.deleteSchedule = async function(id) {
  if (!confirm(`Cancel and delete scheduled WhatsApp message #${id}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/valdho/whatsapp/schedules/' + id, {
      method: 'DELETE'
    });

    if (res.ok) {
      fetchScheduledQueue();
    } else {
      alert('Failed to delete schedule item.');
    }
  } catch (err) {
    console.error('Error deleting schedule item:', err);
  }
};

// Update Valdho statistics grid
function updateValdhoStats() {
  const total = valdhoAppointments.length;
  let completed = 0;
  let step1 = 0;

  valdhoAppointments.forEach(app => {
    let step2Data = {};
    try {
      step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {});
    } catch (e) { step2Data = app.step2_data || {}; }

    if (app.status === 'completed' || Object.keys(step2Data).length > 0) {
      completed++;
    } else {
      step1++;
    }
  });

  const statValdhoTotal = document.getElementById('stat-valdho-total');
  const statValdhoCompleted = document.getElementById('stat-valdho-completed');
  const statValdhoStep1 = document.getElementById('stat-valdho-step1');

  if (statValdhoTotal) statValdhoTotal.textContent = total;
  if (statValdhoCompleted) statValdhoCompleted.textContent = completed;
  if (statValdhoStep1) statValdhoStep1.textContent = step1;
}

// Open WhatsApp Sender & Scheduler Modal
window.openWhatsAppModal = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  selectedLeadForWa = app;

  let step2Data = {};
  try {
    step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {});
  } catch (e) {}

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
    messageInput.value = TEMPLATES.full(name, choicesSummary);
  } else {
    messageInput.value = TEMPLATES.half(name);
  }

  const modalWa = document.getElementById('modal-whatsapp-backdrop');
  if (modalWa) modalWa.classList.add('active');
};

// Open Valdho inspection details modal
window.openValdhoDetails = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  const modalTitle = document.getElementById('modal-title');
  const modalPayId = document.getElementById('modal-pay-id');
  const modalPayStatus = document.getElementById('modal-pay-status');
  const modalPayEmail = document.getElementById('modal-pay-email');
  const modalPayPhone = document.getElementById('modal-pay-phone');
  const modalPayCompany = document.getElementById('modal-pay-company');
  const modalPayDate = document.getElementById('modal-pay-date');
  const modalRawPayload = document.getElementById('modal-raw-payload');
  const modalBackdrop = document.getElementById('modal-backdrop');

  let step2Data = {};
  try {
    step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {});
  } catch (e) {}

  const isCompleted = app.status === 'completed' || Object.keys(step2Data).length > 0;

  if (modalTitle) modalTitle.textContent = `Valdho Lead: ${app.name || app.email}`;
  if (modalPayId) modalPayId.textContent = app.email;
  if (modalPayStatus) {
    modalPayStatus.innerHTML = isCompleted
      ? `<span class="badge badge-captured" style="background-color: #def7ec; color: #03543f;">Full Form (Completed)</span>`
      : `<span class="badge badge-pending" style="background-color: #fef3c7; color: #92400e;">Half Form (Step 1 Only)</span>`;
  }
  if (modalPayEmail) modalPayEmail.textContent = app.email;
  if (modalPayPhone) modalPayPhone.textContent = app.phone || 'N/A';
  if (modalPayCompany) modalPayCompany.textContent = `Firebase Node: /firstoption_agency`;
  if (modalPayDate) modalPayDate.textContent = app.updated_at ? new Date(app.updated_at).toLocaleString('en-IN') : '-';

  if (modalRawPayload) modalRawPayload.textContent = JSON.stringify(app, null, 2);
  if (modalBackdrop) modalBackdrop.classList.add('active');
};

// Fetch Scheduled Messages Queue
async function fetchScheduledQueue() {
  const queueBody = document.getElementById('queue-body');
  try {
    const res = await fetch('/api/valdho/whatsapp/schedules');
    if (!res.ok) throw new Error('Failed to fetch schedules');

    scheduledQueue = await res.json();
    renderQueueTable();
  } catch (e) {
    console.error('Error fetching scheduled queue:', e);
    if (queueBody) {
      queueBody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: #ef4444;">Failed to load queue.</td></tr>`;
    }
  }
}

// Render Scheduled Messages Queue
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
      ? `<span class="badge badge-captured" style="background-color: #def7ec; color: #03543f;">Sent ✅</span>`
      : `<span class="badge badge-pending" style="background-color: #fef3c7; color: #92400e;">Pending ⏳</span>`;

    const schedDate = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('en-IN') : '-';

    return `
      <tr>
        <td data-label="Lead / Contact"><strong>${item.lead_name || item.email}</strong></td>
        <td data-label="Phone">${item.phone}</td>
        <td data-label="Form Type"><span class="choice-pill">${item.form_type}</span></td>
        <td data-label="Target Scheduled Date">${schedDate}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Action" style="text-align: right;">
          <button class="btn" onclick="deleteSchedule(${item.id})" style="background-color: #ef4444; color: white; padding: 4px 8px; font-size: 12px;">
            Cancel
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Close Modals
function closeModal() {
  const el = document.getElementById('modal-backdrop');
  if (el) el.classList.remove('active');
}

function closeWhatsAppModal() {
  const el = document.getElementById('modal-whatsapp-backdrop');
  if (el) el.classList.remove('active');
}

function closeQueueModal() {
  const el = document.getElementById('modal-queue-backdrop');
  if (el) el.classList.remove('active');
}

function closeIntegrationModal() {
  const el = document.getElementById('modal-integration-backdrop');
  if (el) el.classList.remove('active');
}

// DOM Setup
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

  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  safeAddListener('btn-tmpl-half', 'click', () => {
    if (selectedLeadForWa) {
      document.getElementById('wa-message-text').value = TEMPLATES.half(selectedLeadForWa.name);
    }
  });

  safeAddListener('btn-tmpl-full', 'click', () => {
    if (selectedLeadForWa) {
      document.getElementById('wa-message-text').value = TEMPLATES.full(selectedLeadForWa.name, 'Step 2 Completed');
    }
  });

  const modeSelect = document.getElementById('wa-schedule-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const customGroup = document.getElementById('group-custom-date');
      if (customGroup) {
        customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
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
              phone: selectedLeadForWa.phone,
              text: messageText
            })
          });

          const data = await res.json();
          if (data.success) {
            alert(`WhatsApp message sent successfully to ${selectedLeadForWa.phone}!`);
          } else {
            alert(`WhatsApp send result: ${JSON.stringify(data)}`);
          }
        } catch (err) {
          alert(`Failed to send WhatsApp message: ${err.message}`);
        }
      } else {
        let days_delay = null;
        let scheduled_at = null;

        if (scheduleMode === '5_days') days_delay = 5;
        else if (scheduleMode === '10_days') days_delay = 10;
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
              days_delay,
              scheduled_at
            })
          });

          const data = await res.json();
          alert(`WhatsApp message scheduled successfully!\n\nTarget Delivery: ${scheduleMode === '5_days' ? 'After 5 Days' : (scheduleMode === '10_days' ? 'After 10 Days' : scheduled_at)}`);
        } catch (err) {
          alert(`Failed to schedule WhatsApp message: ${err.message}`);
        }
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
