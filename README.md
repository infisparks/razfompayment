# Razorpay Webhook Payment Tracker (razfompayment)

A minimal, secure, and beautiful Node.js/Express web application that serves as a webhook receiver for Razorpay payments and provides a dashboard displaying transaction history.

## Features
- **Secure Webhook Receiver**: Verifies Razorpay signatures using HMAC SHA-256 raw request validation.
- **SQLite Storage**: Automatically stores transactions locally in a single-file SQLite database (`payments.db`).
- **HR-Style Dashboard**: Clean, responsive, minimal UI tracking revenue metrics and payment list.
- **Transaction Inspector**: Inspects raw JSON payloads of webhook events directly from the UI.
- **Simulator Included**: Includes a local script to mock transactions for end-to-end testing without real charges.

## Local Setup
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in a `.env` file:
   ```ini
   PORT=3000
   WEBHOOK_SECRET=your_secret_key
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Simulate a webhook call for testing:
   ```bash
   node scripts/simulate_webhook.js
   ```

## Deploying to Production
For full setup and production deployment instructions, refer to `walkthrough.md`.
