require('dotenv').config();
const db = require('../db');
const firebaseService = require('../services/firebaseService');
const schedulerService = require('../services/schedulerService');

async function testDelete() {
  const testEmail = "test_delete_lead@gmail.com";
  const testPhone = "919999999999";

  console.log("=== 1. Creating Mock Appointment & Scheduled Message ===");
  await new Promise(resolve => {
    db.run(
      `INSERT INTO valdho_appointments (email, name, phone, status) VALUES (?, ?, ?, 'step1_received')`,
      [testEmail, "Test Delete Lead", testPhone],
      resolve
    );
  });

  await schedulerService.scheduleMessage({
    email: testEmail,
    phone: testPhone,
    lead_name: "Test Delete Lead",
    form_type: "half_form",
    message_text: "Follow-up message after 5 days",
    scheduled_at: new Date(Date.now() + 86400000) // 1 day future
  });

  console.log("=== 2. Verifying Schedule is Pending in DB ===");
  db.all('SELECT * FROM whatsapp_schedules WHERE email = ?', [testEmail], (err, rows) => {
    console.log("Pending schedules before delete:", rows);
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log("\n=== 3. Executing Delete Appointment & Cancel Schedules ===");
  await schedulerService.cancelSchedulesForEmail(testEmail);
  await new Promise(resolve => {
    db.run('DELETE FROM valdho_appointments WHERE email = ?', [testEmail], resolve);
  });
  await firebaseService.deleteValdhoAppointment(testEmail);

  await new Promise(r => setTimeout(r, 1000));

  console.log("=== 4. Verifying Schedules and Appointment After Delete ===");
  db.all('SELECT * FROM whatsapp_schedules WHERE email = ?', [testEmail], (err, rows) => {
    console.log("Schedules after delete (should be empty):", rows);
  });

  db.all('SELECT * FROM valdho_appointments WHERE email = ?', [testEmail], (err, rows) => {
    console.log("Appointments after delete (should be empty):", rows);
  });
}

testDelete();
