// Valdho appointments page script
let valdhoAppointments = [];

// Safe DOM event listener helper
function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  }
}

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
    if (statusText) statusText.textContent = 'Server Connected';

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

// Render Valdho Appointments Table
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

    // Extract choices from step 2 or all form data
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
        <td data-label="Action" style="text-align: right;">
          <button class="btn btn-secondary" onclick="openValdhoDetails('${email}')">
            Inspect Data
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

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

// Open Valdho appointment inspection modal
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

// Close inspection modal
function closeModal() {
  const modalBackdrop = document.getElementById('modal-backdrop');
  if (modalBackdrop) modalBackdrop.classList.remove('active');
}

// Close Integration Modal
function closeIntegrationModal() {
  const modalIntegrationBackdrop = document.getElementById('modal-integration-backdrop');
  if (modalIntegrationBackdrop) modalIntegrationBackdrop.classList.remove('active');
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);

  const modalBackdrop = document.getElementById('modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  safeAddListener('btn-open-integration-modal', 'click', () => {
    const modalIntegrationBackdrop = document.getElementById('modal-integration-backdrop');
    if (modalIntegrationBackdrop) modalIntegrationBackdrop.classList.add('active');
  });

  safeAddListener('modal-integration-close', 'click', closeIntegrationModal);
  safeAddListener('btn-cancel-integration', 'click', closeIntegrationModal);

  const modalIntegrationBackdrop = document.getElementById('modal-integration-backdrop');
  if (modalIntegrationBackdrop) {
    modalIntegrationBackdrop.addEventListener('click', (e) => {
      if (e.target === modalIntegrationBackdrop) closeIntegrationModal();
    });
  }

  const formAddIntegration = document.getElementById('form-add-integration');
  if (formAddIntegration) {
    formAddIntegration.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('integration-name').value;
      const url = document.getElementById('integration-url').value;
      const method = document.getElementById('integration-method').value;

      alert(`Integration "${name}" added successfully!\n\nWebhook Endpoint: ${url}\nMethod: ${method}`);
      closeIntegrationModal();
      fetchValdhoAppointments();
    });
  }

  fetchValdhoAppointments();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchValdhoAppointments();
}
