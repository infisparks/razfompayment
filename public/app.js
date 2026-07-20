let valdhoAppointments = [];

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// Deep extract helpers
function findDeepName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    const kLower = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((kLower.includes('name') || kLower.includes('firstname') || kLower.includes('first')) && typeof obj[k] === 'string') {
      const val = obj[k].trim();
      if (val && val !== 'Valdho Lead' && !val.includes('@')) return val;
    }
    if (typeof obj[k] === 'object') {
      const found = findDeepName(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

function findDeepPhone(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    const kLower = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((kLower.includes('phone') || kLower.includes('mobile') || kLower.includes('contact') || kLower.includes('number')) && typeof obj[k] === 'string') {
      const digits = obj[k].replace(/\D/g, '');
      if (digits.length >= 10) return obj[k].trim();
    }
    if (typeof obj[k] === 'object') {
      const found = findDeepPhone(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

async function fetchValdhoAppointments() {
  const bodyEl = document.getElementById('valdho-body');
  try {
    const res = await fetch('/api/valdho/appointments');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    valdhoAppointments = data || [];
    renderValdhoAppointments();
    updateValdhoStats();
  } catch (err) {
    console.error('Error fetching appointments:', err);
    if (bodyEl) {
      bodyEl.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state" style="color: #ef4444;">
            <p>Error loading appointments: ${err.message}</p>
          </td>
        </tr>
      `;
    }
  }
}

function renderValdhoAppointments() {
  const bodyEl = document.getElementById('valdho-body');
  if (!bodyEl) return;

  if (valdhoAppointments.length === 0) {
    bodyEl.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <p>No appointments recorded yet.</p>
        </td>
      </tr>
    `;
    return;
  }

  bodyEl.innerHTML = valdhoAppointments.map(app => {
    let step1Data = {}, step2Data = {}, allData = {};
    try { step1Data = typeof app.step1_data === 'string' ? JSON.parse(app.step1_data) : (app.step1_data || {}); } catch(e){}
    try { step2Data = typeof app.step2_data === 'string' ? JSON.parse(app.step2_data) : (app.step2_data || {}); } catch(e){}
    try { allData = typeof app.all_form_data === 'string' ? JSON.parse(app.all_form_data) : (app.all_form_data || {}); } catch(e){}

    const isCompleted = app.status === 'completed' || Object.keys(step2Data).length > 0;

    const choices = [];
    Object.keys(step2Data).forEach(key => {
      const val = step2Data[key];
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
      : `<span class="badge badge-pending" style="background-color: #fffbebfb; color: #b45309; font-weight: 600;">Step 1 Received (Welcome Sent)</span>`;

    const name = (app.name && app.name !== 'Valdho Lead' ? app.name : null)
      || findDeepName(step1Data) || findDeepName(allData) || findDeepName(step2Data) || 'Valdho Lead';

    const email = app.email || step1Data['Email'] || step1Data.email || allData.email || 'N/A';

    const phone = (app.phone && app.phone !== 'N/A' ? app.phone : null)
      || findDeepPhone(step1Data) || findDeepPhone(allData) || findDeepPhone(step2Data) || 'N/A';

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

window.openValdhoDetails = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  const isCompleted = app.status === 'completed';
  document.getElementById('modal-title').textContent = `Lead Details: ${app.name || app.email}`;
  document.getElementById('modal-pay-id').textContent = app.email;
  document.getElementById('modal-pay-status').innerHTML = isCompleted
    ? `<span class="badge badge-captured">Full Form (Completed)</span>`
    : `<span class="badge badge-pending">Step 1 Received</span>`;
  document.getElementById('modal-pay-email').textContent = app.email;
  document.getElementById('modal-pay-phone').textContent = app.phone || 'N/A';
  document.getElementById('modal-pay-date').textContent = app.updated_at ? new Date(app.updated_at).toLocaleString('en-IN') : '-';
  document.getElementById('modal-raw-payload').textContent = JSON.stringify(app, null, 2);

  document.getElementById('modal-backdrop').classList.add('active');
};

window.deleteAppointment = async function(email, name) {
  if (!confirm(`Are you sure you want to delete lead for "${name}" (${email})?`)) {
    return;
  }

  try {
    const res = await fetch('/api/valdho/appointments/' + encodeURIComponent(email), {
      method: 'DELETE'
    });

    if (res.ok) {
      alert(`Lead for ${name} deleted successfully!`);
      fetchValdhoAppointments();
    } else {
      const data = await res.json();
      alert(`Error deleting lead: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Failed to delete lead: ${err.message}`);
  }
};

function closeModal() { document.getElementById('modal-backdrop').classList.remove('active'); }

document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);
  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  fetchValdhoAppointments();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchValdhoAppointments();
}
