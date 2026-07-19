const db = require('../db');
const firebaseService = require('./firebaseService');

/**
 * Parses incoming WhatsApp Cloud API webhook notifications and logs them to the database.
 *
 * @param {object} payload - The raw webhook payload from Meta.
 */
function parseWebhook(payload) {
  // Print the full incoming JSON body
  console.log('WhatsApp Webhook Received Raw Payload:', JSON.stringify(payload, null, 2));

  if (!payload || !payload.entry || !Array.isArray(payload.entry)) {
    return;
  }

  for (const entry of payload.entry) {
    if (!entry.changes || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value || !value.statuses || !Array.isArray(value.statuses)) continue;

      for (const statusObj of value.statuses) {
        const message_id = statusObj.id;
        const recipient = statusObj.recipient_id;
        const timestamp = statusObj.timestamp;
        const status = statusObj.status; // accepted, sent, delivered, read, failed

        const conversation_id = statusObj.conversation ? statusObj.conversation.id : null;
        const pricing_category = statusObj.pricing ? statusObj.pricing.category : null;
        const billable = statusObj.pricing ? (statusObj.pricing.billable ? 1 : 0) : 0;

        let error_code = null;
        let error_title = null;
        let error_message = null;

        if (status === 'failed' && statusObj.errors && Array.isArray(statusObj.errors) && statusObj.errors[0]) {
          error_code = statusObj.errors[0].code;
          error_title = statusObj.errors[0].title;
          error_message = statusObj.errors[0].message;
        }

        // Log general fields as required
        console.log(`Message ID: ${message_id}`);
        console.log(`Recipient: ${recipient}`);
        console.log(`Timestamp: ${timestamp}`);
        console.log(`Conversation ID: ${conversation_id}`);
        console.log(`Pricing Category: ${pricing_category}`);
        console.log(`Pricing Billable: ${billable}`);
        console.log(`Status: ${status}`);

        if (status === 'failed') {
          console.log(`Error Code: ${error_code}`);
          console.log(`Error Title: ${error_title}`);
          console.log(`Error Message: ${error_message}`);
        }

        // Human-readable state log
        if (status === 'accepted') {
          console.log('WhatsApp Accepted');
        } else if (status === 'sent') {
          console.log('WhatsApp Sent');
        } else if (status === 'delivered') {
          console.log('WhatsApp Delivered');
        } else if (status === 'read') {
          console.log('WhatsApp Read');
        } else if (status === 'failed') {
          console.log('WhatsApp Failed');
        }

        // Save/update status log to Firebase under /razorpay/whatsapp_logs/{message_id}
        const firebaseLogData = {
          message_id,
          recipient,
          status,
          conversation_id,
          pricing_category,
          billable,
          error_code,
          error_title,
          error_message,
          raw_payload: payload
        };
        firebaseService.saveWhatsAppLog(firebaseLogData).catch((fbErr) => {
          console.error('Firebase saveWhatsAppLog error:', fbErr);
        });

        // Update database with status logs
        const query = `
          INSERT INTO whatsapp_logs (
            message_id, recipient, status, conversation_id, pricing_category, billable, error_code, error_title, error_message, raw_payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            status = excluded.status,
            conversation_id = COALESCE(excluded.conversation_id, whatsapp_logs.conversation_id),
            pricing_category = COALESCE(excluded.pricing_category, whatsapp_logs.pricing_category),
            billable = COALESCE(excluded.billable, whatsapp_logs.billable),
            error_code = COALESCE(excluded.error_code, whatsapp_logs.error_code),
            error_title = COALESCE(excluded.error_title, whatsapp_logs.error_title),
            error_message = COALESCE(excluded.error_message, whatsapp_logs.error_message),
            raw_payload = excluded.raw_payload
        `;

        db.run(query, [
          message_id,
          recipient,
          status,
          conversation_id,
          pricing_category,
          billable,
          error_code,
          error_title,
          error_message,
          JSON.stringify(payload)
        ], (err) => {
          if (err) {
            console.error('Failed to save status log to database:', err.message);
          }
        });
      }
    }
  }
}

module.exports = {
  parseWebhook
};
