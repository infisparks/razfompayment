// Valdho Appointments Single Unified Dashboard Script
let valdhoAppointments = [];
let scheduledQueue = [];
let countdownTimerInterval = null;

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// -------------------------------------------------------------
// FETCH APPOINTMENTS & SCHEDULES
// -------------------------------------------------------------
async function fetchValdhoAppointments() {
  const valdhoBody = document.getElementById('valdho-body');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const [resApp, resSched] = await Promise.all([
      fetch('/api/valdho/appointments'),
      fetch('/api/valdho/whatsapp/schedules')
    ]);

    if (!resApp.ok) throw new Error('Failed to fetch Valdho appointments');

    const dataApp = await resApp.json();
    valdhoAppointments = Array.isArray(dataApp) ? dataApp : [];

    if (resSched.ok) {
      const dataSched = await resSched.json();
      scheduledQueue = Array.isArray(dataSched) ? dataSched : (typeof dataSched === 'object' && dataSched !== null ? Object.values(dataSched) : []);
    }

    if (statusDot) {
      statusDot.style.backgroundColor = '#10b981';
      statusDot.style.boxShadow = '0 0 8px #10b981';
    }
    if (statusText) statusText.textContent = 'Server Active';

    renderValdhoTable();
    updateValdhoStats();
    startCountdownTicker();
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
          <td colspan="7" class="empty-state" style="color: #ef4444;">
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
        <td colspan="7" class="empty-state">
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
      ? `<span class="badge badge-captured" style="background-color: #ecfdf5; color: #059669; font-weight: 600;">Full Form Completed ✅</span>`
      : `<span class="badge badge-pending" style="background-color: #fffbebfb; color: #b45309; font-weight: 600;">⚠️ Half Form (Waiting for Full Form)</span>`;

    const name = (app.name && app.name !== 'Valdho Lead' ? app.name : null)
      || step1Data['First Name'] || step1Data.name || step1Data.first_name
      || allData['First Name'] || allData.name || 'Valdho Lead';

    const email = app.email || step1Data['Email'] || step1Data.email || allData.email || 'N/A';

    const phone = (app.phone && app.phone !== 'N/A' ? app.phone : null)
      || step1Data['Phone Number'] || step1Data.phone || step1Data.mobile
      || allData['Phone Number'] || allData.phone || 'N/A';

    const updatedDate = app.updated_at || app.created_at ? new Date(app.updated_at || app.created_at).toLocaleString('en-IN') : '-';

    const emailKey = email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_');
    const leadSched = (scheduledQueue || []).find(s => s.email && s.email.toLowerCase().trim() === email.toLowerCase().trim() && s.status === 'pending');
    
    let leadCountdownHtml = getCountdownBadgeHtml(leadSched ? leadSched.scheduled_at : null, isCompleted);

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
        <td data-label="Next Message Countdown" id="lead-countdown-${emailKey}">${leadCountdownHtml}</td>
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

// -------------------------------------------------------------
// LIVE COUNTDOWN TIMER CALCULATOR (1-SECOND REAL-TIME DECREASE)
// -------------------------------------------------------------
function getCountdownBadgeHtml(targetIso, isCompleted) {
  if (!targetIso) {
    return '<span class="badge badge-pending" style="background-color: #fef3c7; color: #92400e; font-weight: 600;">Scheduling next 1m repeat... ⏳</span>';
  }

  const diffMs = new Date(targetIso).getTime() - Date.now();

  if (diffMs <= 0) {
    return `<span class="badge" style="background-color: #ef4444; color: white; font-weight: 600;">⚡ Sending WhatsApp Repeat...</span>`;
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  let timeString = '';
  if (mins > 0) {
    timeString = `${mins}m ${secs}s remaining`;
  } else {
    timeString = `${secs}s remaining`;
  }

  if (!isCompleted) {
    return `<span class="badge" style="background-color: #e0e7ff; color: #3730a3; font-family: monospace; font-size: 13px; font-weight: 600; padding: 6px 10px; border-radius: 6px;">⏳ ${timeString} (Waiting for Full Form)</span>`;
  }

  return `<span class="badge" style="background-color: #e0e7ff; color: #3730a3; font-family: monospace; font-size: 13px; font-weight: 600; padding: 6px 10px; border-radius: 6px;">⏳ ${timeString} (Next Message Repeat)</span>`;
}

function startCountdownTicker() {
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  countdownTimerInterval = setInterval(() => {
    if (valdhoAppointments && valdhoAppointments.length > 0) {
      valdhoAppointments.forEach(app => {
        const email = (app.email || '').toLowerCase().trim();
        const emailKey = email.replace(/[^a-zA-Z0-9]/g, '_');
        const el = document.getElementById(`lead-countdown-${emailKey}`);
        if (el) {
          const leadSched = (scheduledQueue || []).find(s => s.email && s.email.toLowerCase().trim() === email && s.status === 'pending');
          const isCompleted = app.status === 'completed' || (app.step2_data && Object.keys(app.step2_data).length > 0);
          el.innerHTML = getCountdownBadgeHtml(leadSched ? leadSched.scheduled_at : null, isCompleted);
        }
      });
    }
  }, 1000);
}

// Inspect Lead Details
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

// Delete Appointment (Deletes lead + cancels all scheduled messages)
window.deleteAppointment = async function(email, name) {
  if (!confirm(`Are you sure you want to delete appointment for "${name}" (${email})?\n\nThis will also CANCEL and DELETE all pending scheduled WhatsApp follow-up messages.`)) {
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

function closeModal() { document.getElementById('modal-backdrop').classList.remove('active'); }

// DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);
  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  fetchValdhoAppointments();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchValdhoAppointments();
}
