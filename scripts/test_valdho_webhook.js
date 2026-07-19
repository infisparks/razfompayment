require('dotenv').config();
const db = require('../db');
const firebaseService = require('../services/firebaseService');

const payloadStep1 = {
  "timestamp": "2026-07-19T14:45:20.971Z",
  "source": "valdho",
  "form_data": {
    "First Name": "mudassir ",
    "Email": "mudassirs472@gmail.com",
    "Phone Number": "919958399157"
  },
  "meta": {
    "submission_time": "2026-07-19T14:45:20.972Z",
    "user_agent": "Valdho Form Builder",
    "form_fields_count": 3
  }
};

const payloadStep2 = {
  "timestamp": "2026-07-19T14:45:29.703Z",
  "source": "valdho",
  "form_data": {
    "2-qt30U4oFrjsx3ktRjt-_email": "mudassirs472@gmail.com",
    "cywSbuBtbaqSl0XVX3XDN_multiple-choice": ["Doctor / Clinic"],
    "nJHFDbRpnfJvRAtqOUdx3_multiple-choice": ["Founder / Owner"],
    "4PfxBLzmNynSsvbl8M9PM_multiple-choice": ["Below ₹5L", "₹50L+"],
    "BuoXJ7kzEul1EC2ZCagxe_multiple-choice": ["Yes"]
  },
  "meta": {
    "submission_time": "2026-07-19T14:45:29.703Z",
    "user_agent": "Valdho Form Builder",
    "form_fields_count": 5
  }
};

async function runTest() {
  console.log("=== Testing Step 1 Submission ===");
  const axios = require('axios');
  
  // Test local DB & Firebase functions directly
  const express = require('express');
  const app = express();
  
  // Execute Step 1 payload processing
  const axiosResp1 = await axios.post('http://localhost:3000/valdho/webhook', payloadStep1).catch(err => {
    console.log("Server not running locally yet, testing DB directly");
    return null;
  });

  if (axiosResp1) {
    console.log("Step 1 Webhook Response:", axiosResp1.data);
    
    // Wait 1 sec
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("=== Testing Step 2 Submission ===");
    const axiosResp2 = await axios.post('http://localhost:3000/valdho/webhook', payloadStep2);
    console.log("Step 2 Webhook Response:", axiosResp2.data);
  }
}

// Check database directly
db.all('SELECT * FROM valdho_appointments', [], (err, rows) => {
  if (err) {
    console.error("Error reading SQLite database:", err);
  } else {
    console.log("Current SQLite valdho_appointments records:", rows);
  }
});
