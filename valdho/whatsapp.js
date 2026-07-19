const axios = require('axios');

const API_URL = process.env.EVO_WHATSAPP_API_URL || 'https://evo.infispark.in/message/sendText/mudassir';
const API_KEY = process.env.EVO_WHATSAPP_API_KEY || '4nAJab0oyVlworJu1veRaGfmvkO0yxf2';

/**
 * Format phone number to standard international format (e.g. 919958399157)
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length > 10 && !cleaned.startsWith('91')) {
    cleaned = '91' + cleaned.slice(-10);
  }
  return cleaned;
}

/**
 * Send WhatsApp text message via Evolution API
 */
async function sendEvolutionWhatsApp(rawPhone, textMessage) {
  const formattedNumber = formatPhoneNumber(rawPhone);

  if (!formattedNumber) {
    return { success: false, error: 'Invalid or missing phone number' };
  }

  if (!textMessage) {
    return { success: false, error: 'Message content is empty' };
  }

  const payload = {
    number: formattedNumber,
    text: textMessage
  };

  try {
    console.log(`[Evolution API] Sending message to ${formattedNumber}...`);
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'apiKey': API_KEY
      },
      timeout: 15000
    });

    console.log(`[Evolution API Success] Sent to ${formattedNumber}:`, response.data);
    return {
      success: true,
      number: formattedNumber,
      data: response.data
    };
  } catch (error) {
    const errorDetail = error.response ? error.response.data : error.message;
    console.error(`[Evolution API Failure] Error for ${formattedNumber}:`, errorDetail);
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
