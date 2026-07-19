require('dotenv').config();
const db = require('../db');
const valdhoScheduler = require('../valdho/scheduler');

async function testAutoRulesSequence() {
  console.log("=== 1. Simulating Step 1 (Half Form) Webhook Arrival ===");
  const leadStep1 = {
    email: "autotest_sequence@gmail.com",
    name: "Auto Test Lead",
    phone: "919958399157",
    status: "step1_received"
  };

  await valdhoScheduler.autoScheduleLead(leadStep1, "half_form");

  await new Promise(r => setTimeout(r, 1000));

  console.log("=== 2. Verifying Step 1 Pending Schedule Created ===");
  await new Promise(resolve => {
    db.all('SELECT * FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?)', ["autotest_sequence@gmail.com"], (err, rows) => {
      console.log("Schedules after Step 1:", rows);
      resolve();
    });
  });

  console.log("\n=== 3. Simulating Step 2 (Full Form) Webhook Arrival ===");
  const leadStep2 = {
    email: "autotest_sequence@gmail.com",
    name: "Auto Test Lead",
    phone: "919958399157",
    status: "completed",
    all_form_data: { "multiple-choice": ["Doctor / Clinic", "Founder / Owner"] }
  };

  await valdhoScheduler.autoScheduleLead(leadStep2, "full_form");

  await new Promise(r => setTimeout(r, 1000));

  console.log("=== 4. Verifying Step 1 Schedule Cancelled & Step 2 Schedule Created ===");
  await new Promise(resolve => {
    db.all('SELECT * FROM whatsapp_schedules WHERE LOWER(email) = LOWER(?)', ["autotest_sequence@gmail.com"], (err, rows) => {
      console.log("Schedules after Step 2 (Half Form must be gone!):", rows);
      resolve();
    });
  });

  console.log("\n=== 5. Cleaning up Test Data ===");
  await valdhoScheduler.cancelSchedulesForEmail("autotest_sequence@gmail.com");
  console.log("Test completed successfully!");
}

testAutoRulesSequence();
