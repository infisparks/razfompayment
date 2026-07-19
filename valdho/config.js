// Valdho Automation Central Configuration File
module.exports = {
  // Duration interval between automated messages (in minutes)
  INTERVAL_MINUTES: 5,

  // Enable continuous repeat every 5 minutes (true/false)
  ENABLE_REPEAT_SEQUENCE: true,

  // Message 1: Step 1 (Half Form / Incomplete Form) Template
  halfFormMessage: `*Dear {name},*\n\nWe noticed you started your appointment request. Please complete the remaining steps in the form to finalize your booking.\n\nOur team is here to assist you!\n\n*Thank you!*`,

  // Message 2: Step 2 (Full Form / Completed Form) Template
  fullFormMessage: `*Dear {name},*\n\nYour appointment registration has been successfully received!\n\n*Details:* {answers}\n\nOur team will contact you shortly to confirm the appointment schedule.\n\n*Thank you for choosing us!*`
};
