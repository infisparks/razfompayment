// Local state containers
let payments = [];
let valdhoAppointments = [];
let currentTab = 'razorpay';

// DOM Element references - Common & Razorpay
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const paymentsBody = document.getElementById('payments-body');
const statRevenue = document.getElementById('stat-revenue');
const statSuccessCount = document.getElementById('stat-success-count');
const statFailedCount = document.getElementById('stat-failed-count');
const statTotalCount = document.getElementById('stat-total-count');
const btnRefreshPayments = document.getElementById('btn-refresh-payments');

// DOM Element references - Valdho View
const valdhoBody = document.getElementById('valdho-body');
const statValdhoTotal = document.getElementById('stat-valdho-total');
const statValdhoCompleted = document.getElementById('stat-valdho-completed');
const statValdhoStep1 = document.getElementById('stat-valdho-step1');
const btnRefreshValdho = document.getElementById('btn-refresh-valdho');

// Modal Element references - Detail Inspection
const modalBackdrop = document.getElementById('modal-backdrop');
const modalClose = document.getElementById('modal-close');
const modalBtnClose = document.getElementById('modal-btn-close');
const modalTitle = document.getElementById('modal-title');
const modalPayId = document.getElementById('modal-pay-id');
const modalPayStatus = document.getElementById('modal-pay-status');
const modalPayEmail = document.getElementById('modal-pay-email');
const modalPayPhone = document.getElementById('modal-pay-phone');
const modalPayCompany = document.getElementById('modal-pay-company');
const modalPayDate = document.getElementById('modal-pay-date');
const modalRawPayload = document.getElementById('modal-raw-payload');

// Modal Element references - Add Integration Modal
const btnOpenIntegrationModal = document.getElementById('btn-open-integration-modal');
const modalIntegrationBackdrop = document.getElementById('modal-integration-backdrop');
const modalIntegrationClose = document.getElementById('modal-integration-close');
const btnCancelIntegration = document.getElementById('btn-cancel-integration');
const formAddIntegration = document.getElementById('form-add-integration');

// Tab Switching
window.switchTab = function(tabName) {
  currentTab = tabName;
  const tabRazorpay = document.getElementById('tab-razorpay');
  const tabValdho = document.getElementById('tab-valdho');
  const viewRazorpay = document.getElementById('view-razorpay');
  const viewValdho = document.getElementById('view-valdho');

  if (tabName === 'razorpay') {
    tabRazorpay.classList.add('active');
    tabValdho.classList.remove('active');
    viewRazorpay.style.display = 'block';
    viewValdho.style.display = 'none';

    pageTitle.textContent = 'Razorpay Payments';
    pageSubtitle.textContent = 'Real-time payment webhook tracking for raz.infiplus.in';
    fetchPayments();
  } else if (tabName === 'valdho') {
    tabValdho.classList.add('active');
    tabRazorpay.classList.remove('active');
    viewValdho.style.display = 'block';
    viewRazorpay.style.display = 'none';

    pageTitle.textContent = 'valdho_first_option_agency';
    pageSubtitle.textContent = 'Real-time appointment webhook tracking stored under Firebase node /firstoption_agency';
    fetchValdhoAppointments();
  }
};

// Fetch Razorpay payments list from API
async function fetchPayments() {
  try {
    const res = await fetch('/api/payments');
    if (!res.ok) throw new Error('API server returned error response');
    
    payments = await res.json();
    
    statusDot.style.backgroundColor = '#10b981';
    statusDot.style.boxShadow = '0 0 8px #10b981';
    statusText.textContent = 'Server Connected';
    
    renderPaymentsTable();
    updateStatsGrid();
  } catch (error) {
    console.error('Error fetching payments:', error);
    
    statusDot.style.backgroundColor = '#ef4444';
    statusDot.style.boxShadow = '0 0 8px #ef4444';
    statusText.textContent = 'Server Disconnected';
    
    paymentsBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="color: #ef4444;">
          <i data-lucide="alert-triangle" style="width: 24px; height: 24px; color: #ef4444; margin-bottom: 8px;"></i>
          <p>Failed to connect to the backend server. Please verify the Express app is running.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
  }
}

// Render payments table
function renderPaymentsTable() {
  if (payments.length === 0) {
    paymentsBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <i data-lucide="inbox" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>No payments received yet. Configure your Razorpay webhook and run a payment to inspect.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
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
      
    const statusClass = `badge-${pay.status.toLowerCase()}`;
    
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
  
  lucide.createIcons();
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

  statRevenue.textContent = formattedRevenue;
  statSuccessCount.textContent = successCount;
  statFailedCount.textContent = failedCount;
  statTotalCount.textContent = payments.length;
}

// Fetch Valdho Appointments from API
async function fetchValdhoAppointments() {
  try {
    const res = await fetch('/api/valdho/appointments');
    if (!res.ok) throw new Error('Failed to fetch Valdho appointments');

    valdhoAppointments = await res.json();
    renderValdhoTable();
    updateValdhoStats();
  } catch (error) {
    console.error('Error fetching Valdho appointments:', error);
    valdhoBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="color: #ef4444;">
          <i data-lucide="alert-triangle" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>Error loading Valdho appointment data.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
  }
}

// Render Valdho Appointments Table
function renderValdhoTable() {
  if (valdhoAppointments.length === 0) {
    valdhoBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i data-lucide="folder-open" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>No appointments in <strong>firstoption_agency</strong> yet. Submit a Valdho form to test real-time webhook storage.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  valdhoBody.innerHTML = valdhoAppointments.map(app => {
    let allData = {};
    try {
      allData = typeof app.all_form_data === 'string' ? JSON.parse(app.all_form_data) : (app.all_form_data || {});
    } catch (e) {
      allData = app.all_form_data || {};
    }

    // Extract multi-choice answers for pills display
    const choices = [];
    Object.keys(allData).forEach(key => {
      const val = allData[key];
      if (Array.isArray(val)) {
        choices.push(...val);
      } else if (typeof val === 'string' && !key.toLowerCase().includes('email') && !key.toLowerCase().includes('name') && !key.toLowerCase().includes('phone')) {
        choices.push(val);
      }
    });

    const choicesHtml = choices.length > 0
      ? choices.map(c => `<span class="choice-pill">${c}</span>`).join('')
      : '<em style="color: #9ca3af; font-size: 13px;">Step 1 Pending...</em>';

    const isCompleted = app.status === 'completed';
    const statusBadge = isCompleted
      ? `<span class="badge badge-captured">Completed 2-Step</span>`
      : `<span class="badge badge-pending">Step 1 Received</span>`;

    const updatedDate = app.updated_at ? new Date(app.updated_at).toLocaleString('en-IN') : '-';

    return `
      <tr>
        <td data-label="Lead / Contact">
          <div class="payer-info">
            <strong style="color: #111827;">${app.name || 'Valdho Lead'}</strong>
            <span class="payer-email">${app.email || 'N/A'}</span>
          </div>
        </td>
        <td data-label="Phone Number">${app.phone || 'N/A'}</td>
        <td data-label="Form Selections / Answers">${choicesHtml}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Last Submission">${updatedDate}</td>
        <td data-label="Action" style="text-align: right;">
          <button class="btn btn-secondary" onclick="openValdhoDetails('${app.email}')">
            Inspect Data
          </button>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Update Valdho statistics grid
function updateValdhoStats() {
  const total = valdhoAppointments.length;
  let completed = 0;
  let step1 = 0;

  valdhoAppointments.forEach(app => {
    if (app.status === 'completed') {
      completed++;
    } else {
      step1++;
    }
  });

  statValdhoTotal.textContent = total;
  statValdhoCompleted.textContent = completed;
  statValdhoStep1.textContent = step1;
}

// Open Payment inspection modal
window.openDetails = function(paymentId) {
  const pay = payments.find(p => p.payment_id === paymentId);
  if (!pay) return;

  const date = pay.created_at 
    ? new Date(pay.created_at * 1000).toLocaleString('en-IN') 
    : new Date(pay.received_at).toLocaleString('en-IN');

  modalTitle.textContent = `Inspect Payment: ${pay.payment_id}`;
  modalPayId.textContent = pay.payment_id;
  modalPayStatus.innerHTML = `<span class="badge badge-${pay.status.toLowerCase()}">${pay.status}</span>`;
  modalPayEmail.textContent = pay.email || 'N/A';
  modalPayPhone.textContent = pay.phone || 'N/A';
  modalPayCompany.textContent = pay.company_name || 'N/A';
  modalPayDate.textContent = date;
  
  try {
    const rawObj = JSON.parse(pay.raw_payload);
    modalRawPayload.textContent = JSON.stringify(rawObj, null, 2);
  } catch (e) {
    modalRawPayload.textContent = pay.raw_payload || 'No raw payload available.';
  }

  modalBackdrop.classList.add('active');
};

// Open Valdho appointment inspection modal
window.openValdhoDetails = function(email) {
  const app = valdhoAppointments.find(a => a.email === email);
  if (!app) return;

  modalTitle.textContent = `Valdho Lead: ${app.name || app.email}`;
  modalPayId.textContent = app.email;
  modalPayStatus.innerHTML = app.status === 'completed'
    ? `<span class="badge badge-captured">Completed 2-Step</span>`
    : `<span class="badge badge-pending">Step 1 Received</span>`;
  modalPayEmail.textContent = app.email;
  modalPayPhone.textContent = app.phone || 'N/A';
  modalPayCompany.textContent = `Node: /firstoption_agency`;
  modalPayDate.textContent = app.updated_at ? new Date(app.updated_at).toLocaleString('en-IN') : '-';

  modalRawPayload.textContent = JSON.stringify(app, null, 2);
  modalBackdrop.classList.add('active');
};

// Close inspection modal
function closeModal() {
  modalBackdrop.classList.remove('active');
}

modalClose.addEventListener('click', closeModal);
modalBtnClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

// Refresh button actions
btnRefreshPayments.addEventListener('click', fetchPayments);
btnRefreshValdho.addEventListener('click', fetchValdhoAppointments);

// Add Integration Modal Control
btnOpenIntegrationModal.addEventListener('click', () => {
  modalIntegrationBackdrop.classList.add('active');
});

function closeIntegrationModal() {
  modalIntegrationBackdrop.classList.remove('active');
}

modalIntegrationClose.addEventListener('click', closeIntegrationModal);
btnCancelIntegration.addEventListener('click', closeIntegrationModal);
modalIntegrationBackdrop.addEventListener('click', (e) => {
  if (e.target === modalIntegrationBackdrop) closeIntegrationModal();
});

// Handle Integration Form Submit
formAddIntegration.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('integration-name').value;
  const url = document.getElementById('integration-url').value;
  const method = document.getElementById('integration-method').value;

  alert(`Integration "${name}" added successfully!\n\nWebhook Endpoint: ${url}\nMethod: ${method}`);
  closeIntegrationModal();
  switchTab('valdho');
});

// Initial load
fetchPayments();
