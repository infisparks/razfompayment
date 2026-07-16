const axios = require('axios');

/**
 * Format phone number to E.164 without leading '+' (e.g. 919876543210)
 * Removes all spaces, dashes, brackets, and leading '+'
 * If the resulting number is exactly 10 digits, prepends '91'
 *
 * @param {string} phone
 * @returns {string}
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove spaces, dashes, brackets, and +
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  
  // If exactly 10 digits (common in India), prepend country code '91'
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  
  return cleaned;
}

/**
 * Converts Razorpay paise into Rupees with ₹ symbol (e.g. 50000 -> ₹500.00)
 *
 * @param {number|string} amountPaise
 * @returns {string}
 */
function formatAmount(amountPaise) {
  const amountRupees = Number(amountPaise) / 100;
  return `₹${amountRupees.toFixed(2)}`;
}

/**
 * Delay execution for the specified milliseconds
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a WhatsApp payment success template message using Meta Cloud API.
 * Retries up to 3 times on failure with delays of 2s, 5s, and 10s.
 *
 * @param {string} phone - Customer's phone number
 * @param {string} companyName - Company name (body parameter 1)
 * @param {number|string} amount - Amount in paise (body parameter 2)
 * @returns {Promise<{success: boolean, data?: any, error?: any}>}
 */
async function sendPaymentSuccess(phone, companyName, amount) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'payment_success';

  if (!accessToken || !phoneNumberId) {
    const err = new Error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.');
    return { success: false, error: err.message };
  }

  const formattedPhone = formatPhoneNumber(phone);
  const formattedAmount = formatAmount(amount);
  const customerName = (companyName && companyName.trim()) ? companyName.trim() : 'Customer';

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: formattedPhone,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: 'en'
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: customerName
            },
            {
              type: 'text',
              text: formattedAmount
            }
          ]
        }
      ]
    }
  };

  const retryDelays = [2000, 5000, 10000]; // Delays of 2s, 5s, and 10s
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.post(url, payload, { headers });
      // Log all responses
      console.log(`WhatsApp API response (Attempt ${attempt + 1}):`, JSON.stringify(response.data));
      return { success: true, data: response.data };
    } catch (error) {
      const errorResponse = error.response ? error.response.data : error.message;
      // Log all error responses
      console.error(`WhatsApp API error (Attempt ${attempt + 1}):`, JSON.stringify(errorResponse));

      if (attempt < retryDelays.length) {
        const waitTime = retryDelays[attempt];
        attempt++;
        console.warn(`WhatsApp send failed. Retrying attempt ${attempt} after ${waitTime / 1000}s...`);
        await delay(waitTime);
      } else {
        // All retries failed
        return { success: false, error: errorResponse };
      }
    }
  }
}

module.exports = {
  sendPaymentSuccess
};
