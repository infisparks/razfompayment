// Local state container for payments
let payments = [];

// DOM Element references
const paymentsBody = document.getElementById('payments-body');
const statRevenue = document.getElementById('stat-revenue');
const statSuccessCount = document.getElementById('stat-success-count');
const statFailedCount = document.getElementById('stat-failed-count');
const statTotalCount = document.getElementById('stat-total-count');
const btnRefresh = document.getElementById('btn-refresh');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Modal Element references
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

// Fetch payments list from API
async function fetchPayments() {
  try {
    const res = await fetch('/api/payments');
    if (!res.ok) throw new Error('API server returned error response');
    
    payments = await res.json();
    
    // Set status widget to Active
    statusDot.style.backgroundColor = '#10b981';
    statusDot.style.boxShadow = '0 0 8px #10b981';
    statusText.textContent = 'Server Connected';
    
    renderPaymentsTable();
    updateStatsGrid();
  } catch (error) {
    console.error('Error fetching payments:', error);
    
    // Set status widget to Error
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

// Render payments inside table with labels for mobile cards
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

// Recalculate metrics on data fetch
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

// Modal closing event actions
function closeModal() {
  modalBackdrop.classList.remove('active');
}

modalClose.addEventListener('click', closeModal);
modalBtnClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) {
    closeModal();
  }
});

// Refresh button trigger
btnRefresh.addEventListener('click', () => {
  fetchPayments();
});

// Load payments on startup
fetchPayments();
