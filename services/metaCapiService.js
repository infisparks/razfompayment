const axios = require('axios');
const crypto = require('crypto');

/**
 * Meta Conversions API (CAPI) Integration Service
 * Target Pixel / Dataset ID: 1307016724814793
 */

const META_PIXEL_ID = process.env.META_PIXEL_ID || '1307016724814793';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAAcwP3ozPkIBSOsJEKn1Ie2LHyuPrJArrMvwnp6qOC79Hu5E2FJVI2bgMRaqpiD4dyNkYzBDyMGINLOhrgErMCoqRvhPaxKB3BPGMCFTJ7TZAyqYEwNOiBav4CvNZCRCf3UWsvfHmn5SCNB0rK3OVn8pusTtNaWg4En9UGoZCDePsxmgbvGnAMolbYkZBgZDZD';

/**
 * SHA-256 Hasher required for Meta User Data privacy compliance
 */
function hashData(val) {
  if (!val) return null;
  const str = String(val).trim().toLowerCase();
  if (!str || str === 'n/a' || str === 'valdho lead') return null;
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Format phone number to standard international format (e.g. 919958399157)
 */
function formatPhone(phone) {
  if (!phone || phone === 'N/A') return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
}

/**
 * Dispatch LeadIncomplete Retargeting Event to Meta Conversions API
 * 
 * @param {string} email - Lead email
 * @param {string} phone - Lead phone number
 * @param {string} leadName - Lead name
 * @returns {Promise<Object>}
 */
async function sendMetaRetargetingEvent(email, phone, leadName) {
  if (!email) {
    console.warn('[Meta CAPI Warning] Cannot send Meta event without email identifier');
    return { success: false, error: 'Missing email' };
  }

  const hashedEmail = hashData(email);
  const hashedPhone = hashData(formatPhone(phone));
  const hashedName = hashData(leadName);

  const eventTime = Math.floor(Date.now() / 1000);

  const payload = {
    data: [
      {
        event_name: 'LeadIncomplete', // Custom Meta Event for Retargeting Ads
        event_time: eventTime,
        event_source_url: 'https://raz.infiplus.in/valdho_first_option_agency',
        action_source: 'website',
        user_data: {
          em: hashedEmail ? [hashedEmail] : [],
          ph: hashedPhone ? [hashedPhone] : [],
          fn: hashedName ? [hashedName] : []
        },
        custom_data: {
          form_type: 'half_form',
          abandoned_after_minutes: 10,
          company: 'firstoption_agency'
        }
      }
    ]
  };

  const targetUrl = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  try {
    console.log(`[Meta CAPI] Dispatching retargeting event 'LeadIncomplete' for ${email}...`);
    const response = await axios.post(targetUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    console.log(`[Meta CAPI Success] Meta accepted retargeting event for ${email}:`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    const errData = err.response ? err.response.data : err.message;
    console.error(`[Meta CAPI Failure] Failed to send event for ${email}:`, JSON.stringify(errData));
    return { success: false, error: errData };
  }
}

module.exports = {
  hashData,
  sendMetaRetargetingEvent
};
