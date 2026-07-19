require('dotenv').config();
const db = require('../db');
const evolutionWhatsappService = require('../services/evolutionWhatsappService');
const schedulerService = require('../services/schedulerService');

async function testWhatsApp() {
  console.log("=== 1. Testing Evolution WhatsApp Instant Send API ===");
  const testPhone = "919958399157";
  const testMsg = "*Dear mudassir,*\n\nYour *OPD appointment* has been successfully registered.\n\nThank you for choosing us!";
  
  const sendResult = await evolutionWhatsappService.sendEvolutionWhatsApp(testPhone, testMsg);
  console.log("Instant Send Result:", sendResult);

  console.log("\n=== 2. Testing Scheduling Message for 2 Seconds in Future ===");
  const targetDate = new Date(Date.now() + 2000); // 2 seconds from now
  const scheduledItem = await schedulerService.scheduleMessage({
    email: "mudassirs472@gmail.com",
    phone: testPhone,
    lead_name: "mudassir",
    form_type: "half_form",
    message_text: "*Dear mudassir,*\n\nThis is your 5-day scheduled follow-up reminder for Valdho appointment.",
    scheduled_at: targetDate
  });

  console.log("Scheduled Record Created:", scheduledItem);

  console.log("\n=== 3. Waiting 3 Seconds for Schedule Trigger ===");
  await new Promise(r => setTimeout(r, 3000));

  console.log("=== 4. Executing Scheduler Engine Dispatch Check ===");
  await schedulerService.checkAndDispatchDueMessages();

  // Wait 1 sec
  await new Promise(r => setTimeout(r, 1000));

  console.log("=== 5. Verifying DB Record Status ===");
  db.all('SELECT * FROM whatsapp_schedules WHERE phone = ?', [testPhone], (err, rows) => {
    if (err) console.error(err);
    else console.log("Final Scheduled Messages DB Rows:", rows);
  });
}

testWhatsApp();
