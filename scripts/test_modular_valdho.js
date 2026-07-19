require('dotenv').config();
const db = require('../db');
const valdhoScheduler = require('../valdho/scheduler');
const valdhoFirebase = require('../valdho/firebase');

async function runModularTest() {
  console.log("=== 1. Testing Pause/Resume Automation Engine State ===");
  console.log("Initial status:", valdhoScheduler.getAutomationStatus());
  
  valdhoScheduler.pauseAutomation();
  console.log("Status after pause:", valdhoScheduler.getAutomationStatus());

  valdhoScheduler.resumeAutomation();
  console.log("Status after resume:", valdhoScheduler.getAutomationStatus());

  console.log("\n=== 2. Testing Flexible Interval Scheduling (1m) ===");
  const testEmail = "modal_test_lead@gmail.com";
  const schedRecord = await valdhoScheduler.scheduleMessage({
    email: testEmail,
    phone: "919958399157",
    lead_name: "Modal Test Lead",
    form_type: "half_form",
    message_text: "Test interval 1m message",
    interval: "1m"
  });

  console.log("Scheduled Record Created:", schedRecord);

  console.log("\n=== 3. Testing Message Log Retrieval ===");
  const logs = await valdhoFirebase.getMessageLogs();
  console.log("Firebase Message Logs count:", logs ? logs.length : 0);

  console.log("\n=== 4. Cleaning up Test Schedule ===");
  await valdhoScheduler.cancelSchedulesForEmail(testEmail);
  console.log("Test Schedule cancelled cleanly.");
}

runModularTest();
