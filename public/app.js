// Local state containers
let payments = [];
let valdhoAppointments = [];
let currentTab = 'razorpay';

// Safe DOM event listener helper
function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  }
}

// Tab Switching Function
window.switchTab = function(tabName) {
  currentTab = tabName;
  const tabRazorpay = document.getElementById('tab-razorpay');
  const tabValdho = document.getElementById('tab-valdho');
  const viewRazorpay = document.getElementById('view-razorpay');
  const viewValdho = document.getElementById('view-valdho');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  if (tabName === 'razorpay') {
    if (tabRazorpay) tabRazorpay.classList.add('active');
    if (tabValdho) tabValdho.classList.remove('active');
    if (viewRazorpay) viewRazorpay.style.display = 'block';
    if (viewValdho) viewValdho.style.display = 'none';

    if (pageTitle) pageTitle.textContent = 'Razorpay Payments';
    if (pageSubtitle) pageSubtitle.textContent = 'Real-time payment webhook tracking for raz.infiplus.in';
    fetchPayments();
  } else if (tabName === 'valdho') {
    if (tabValdho) tabValdho.classList.add('active');
    if (tabRazorpay) tabRazorpay.classList.remove('active');
    if (viewValdho) viewValdho.style.display = 'block';
    if (viewRazorpay) viewRazorpay.style.display = 'none';

    if (pageTitle) pageTitle.textContent = 'valdho_first_option_agency';
    if (pageSubtitle) pageSubtitle.textContent = 'Real-time appointment webhook tracking stored under Firebase node /firstoption_agency';
    fetchValdhoAppointments();
  }
};

// Fetch Razorpay payments from API
async function fetchPayments() {
  const paymentsBody = document.getElementById('payments-body');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const res = await fetch('/api/payments');
    if (!res.ok) throw new Error('API server returned error response');
    
    payments = await res.json();
    
    if (statusDot) {
      statusDot.style.backgroundColor = '#10b981';
      statusDot.style.boxShadow = '0 0 8px #10b981';
    }
    if (statusText) statusText.textContent = 'Server Connected';
    
    renderPaymentsTable();
    updateStatsGrid();
  } catch (error) {
    console.error('Error fetching payments:', error);
    
    if (statusDot) {
      statusDot.style.backgroundColor = '#ef4444';
      statusDot.style.boxShadow = '0 0 8px #ef4444';
    }
    if (statusText) statusText.textContent = 'Server Disconnected';
    
    if (paymentsBody) {
      paymentsBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state" style="color: #ef4444;">
            <i data-lucide="alert-triangle" style="width: 24px; height: 24px; color: #ef4444; margin-bottom: 8px;"></i>
            <p>Failed to connect to the backend server. Please verify the Express app is running.</p>
          </td>
        </tr>
      `;
    }
    if (window.lucide) lucide.createIcons();
  }
}

// Render payments inside table
function renderPaymentsTable() {
  const paymentsBody = document.getElementById('payments-body');
  if (!paymentsBody) return;

  if (payments.length === 0) {
    paymentsBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <i data-lucide="inbox" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>No payments received yet. Configure your Razorpay webhook and run a payment to inspect.</p>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  paymentsBody.innerHTML = payments.map(pay => {
    const formattedAmount = (pay.amount / 100).toLocaleString('en-IN', {
      style: 'currency',
      currency: pay.currency || 'INR'
    });
    
    const date = pay.created_at 
      ? new Date(pay.created_at * 1000).toLocaleString('en-IN') 
      : new Date(pay.received_at).toLocaleString('en-IN');
      
    const statusClass = `badge-${(pay.status || 'captured').toLowerCase()}`;
    
    return `
      <tr>
        <td data-label="Payment ID"><strong>${pay.payment_id}</strong></td>
        <td data-label="Payer / Contact">
          <div class="payer-info">
            <span class="payer-email">${pay.email || 'N/A'}</span>
            <span class="payer-phone">${pay.phone || 'N/A'}</span>
          </div>
        </td>
        <td data-label="Company Name">${pay.company_name || '<em style="color: #9ca3af;">None</em>'}</td>
        <td data-label="Amount"><strong>${formattedAmount}</strong></td>
        <td data-label="Status">
          <span class="badge ${statusClass}">${pay.status}</span>
        </td>
        <td data-label="Method">
          <span class="method-badge">${pay.method || 'N/A'}</span>
        </td>
        <td data-label="Transaction Date">${date}</td>
        <td data-label="Action" style="text-align: right;">
          <button class="btn btn-secondary" onclick="openDetails('${pay.payment_id}')">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  if (window.lucide) lucide.createIcons();
}

// Recalculate Razorpay metrics
function updateStatsGrid() {
  let totalRevenue = 0;
  let successCount = 0;
  let failedCount = 0;

  payments.forEach(pay => {
    const status = (pay.status || '').toLowerCase();
    if (status === 'captured' || status === 'success') {
      totalRevenue += pay.amount;
      successCount++;
    } else if (status === 'failed') {
      failedCount++;
    }
  });

  const formattedRevenue = (totalRevenue / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR'
  });

  const statRevenue = document.getElementById('stat-revenue');
  const statSuccessCount = document.getElementById('stat-success-count');
  const statFailedCount = document.getElementById('stat-failed-count');
  const statTotalCount = document.getElementById('stat-total-count');

  if (statRevenue) statRevenue.textContent = formattedRevenue;
  if (statSuccessCount) statSuccessCount.textContent = successCount;
  if (statFailedCount) statFailedCount.textContent = failedCount;
  if (statTotalCount) statTotalCount.textContent = payments.length;
}

// Fetch Valdho Appointments from API
async function fetchValdhoAppointments() {
  const valdhoBody = document.getElementById('valdho-body');

  try {
    const res = await fetch('/api/valdho/appointments');
    if (!res.ok) throw new Error('Failed to fetch Valdho appointments');

    valdhoAppointments = await res.json();
    renderValdhoTable();
    updateValdhoStats();
  } catch (error) {
    console.error('Error fetching Valdho appointments:', error);
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

// Render Valdho Appointments Table with Full Form vs Half Form badges
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

    // Check if Full Form (Completed) or Half Form (Step 1 Only)
    const hasStep2Data = Object.keys(step2Data).length > 0;
    const isCompleted = app.status === 'completed' || hasStep2Data;

    // Extract choices from step 2 / all form data
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

    // Status Badge: Full Form vs Half Form
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

// Open Payment inspection modal
window.openDetails = function(paymentId) {
  const pay = payments.find(p => p.payment_id === paymentId);
  if (!pay) return;

  const date = pay.created_at 
    ? new Date(pay.created_at * 1000).toLocaleString('en-IN') 
    : new Date(pay.received_at).toLocaleString('en-IN');

  const modalTitle = document.getElementById('modal-title');
  const modalPayId = document.getElementById('modal-pay-id');
  const modalPayStatus = document.getElementById('modal-pay-status');
  const modalPayEmail = document.getElementById('modal-pay-email');
  const modalPayPhone = document.getElementById('modal-pay-phone');
  const modalPayCompany = document.getElementById('modal-pay-company');
  const modalPayDate = document.getElementById('modal-pay-date');
  const modalRawPayload = document.getElementById('modal-raw-payload');
  const modalBackdrop = document.getElementById('modal-backdrop');

  if (modalTitle) modalTitle.textContent = `Inspect Payment: ${pay.payment_id}`;
  if (modalPayId) modalPayId.textContent = pay.payment_id;
  if (modalPayStatus) modalPayStatus.innerHTML = `<span class="badge badge-${(pay.status || '').toLowerCase()}">${pay.status}</span>`;
  if (modalPayEmail) modalPayEmail.textContent = pay.email || 'N/A';
  if (modalPayPhone) modalPayPhone.textContent = pay.phone || 'N/A';
  if (modalPayCompany) modalPayCompany.textContent = pay.company_name || 'N/A';
  if (modalPayDate) modalPayDate.textContent = date;
  
  if (modalRawPayload) {
    try {
      const rawObj = JSON.parse(pay.raw_payload);
      modalRawPayload.textContent = JSON.stringify(rawObj, null, 2);
    } catch (e) {
      modalRawPayload.textContent = pay.raw_payload || 'No raw payload available.';
    }
  }

  if (modalBackdrop) modalBackdrop.classList.add('active');
};

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

// Set up event listeners safely on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  safeAddListener('modal-close', 'click', closeModal);
  safeAddListener('modal-btn-close', 'click', closeModal);
  
  const modalBackdrop = document.getElementById('modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  // Refresh buttons
  safeAddListener('btn-refresh-payments', 'click', fetchPayments);
  safeAddListener('btn-refresh', 'click', fetchPayments);
  safeAddListener('btn-refresh-valdho', 'click', fetchValdhoAppointments);

  // Add Integration Modal triggers
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

  // Integration Form Submit
  const formAddIntegration = document.getElementById('form-add-integration');
  if (formAddIntegration) {
    formAddIntegration.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('integration-name').value;
      const url = document.getElementById('integration-url').value;
      const method = document.getElementById('integration-method').value;

      alert(`Integration "${name}" added successfully!\n\nWebhook Endpoint: ${url}\nMethod: ${method}`);
      closeIntegrationModal();
      switchTab('valdho');
    });
  }

  // Initial load
  fetchPayments();
});

// Also trigger immediately if DOM is already ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  fetchPayments();
}
