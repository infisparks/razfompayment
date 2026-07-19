const axios = require('axios');

/**
 * Service for sending WhatsApp messages via Evolution API.
 * API URL: https://evo.infispark.in/message/sendText/mudassir
 * API Key Header: apikey
 */

const API_URL = process.env.EVO_WHATSAPP_API_URL || 'https://evo.infispark.in/message/sendText/mudassir';
const API_KEY = process.env.EVO_WHATSAPP_API_KEY || '4nAJab0oyVlworJu1veRaGfmvkO0yxf2';

/**
 * Clean and format phone number to standard international format (e.g., 919958399157)
 * 
 * @param {string} phone 
 * @returns {string}
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, ''); // Remove non-numeric characters
  
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    // Already has 91 prefix
  } else if (cleaned.length > 10 && !cleaned.startsWith('91')) {
    cleaned = '91' + cleaned.slice(-10);
  }
  
  return cleaned;
}

/**
 * Send WhatsApp text message via Evolution API
 * 
 * @param {string} rawPhone - Recipient phone number
 * @param {string} textMessage - Content of message
 * @returns {Promise<Object>}
 */
async function sendEvolutionWhatsApp(rawPhone, textMessage) {
  const formattedNumber = formatPhoneNumber(rawPhone);

  if (!formattedNumber) {
    console.error('[Evolution WhatsApp Error] Invalid or missing phone number:', rawPhone);
    return { success: false, error: 'Invalid phone number' };
  }

  if (!textMessage) {
    console.error('[Evolution WhatsApp Error] Message content is empty');
    return { success: false, error: 'Message content is empty' };
  }

  const payload = {
    number: formattedNumber,
    text: textMessage
  };

  try {
    console.log(`[Evolution WhatsApp] Sending message to ${formattedNumber}...`);
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'apiKey': API_KEY
      },
      timeout: 15000
    });

    console.log(`[Evolution WhatsApp Success] Response from Evolution API for ${formattedNumber}:`, response.data);
    return {
      success: true,
      number: formattedNumber,
      data: response.data
    };
  } catch (error) {
    const errorDetail = error.response ? error.response.data : error.message;
    console.error(`[Evolution WhatsApp Failure] Error sending to ${formattedNumber}:`, errorDetail);
    return {
      success: false,
      number: formattedNumber,
      error: errorDetail
    };
  }
}

module.exports = {
  formatPhoneNumber,
  sendEvolutionWhatsApp
};
