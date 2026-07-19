const express = require('express');
const webhookController = require('../controllers/webhook_controller');

const router = express.Router();

// ============================================================
// PUBLIC WEBHOOKS (No auth - called by external services)
// ============================================================

// M-Pesa Paybill Callback (from Safaricom)
router.post('/mpesa/paybill', webhookController.mpesaPaybillWebhook);

// M-Pesa Till Callback (from Safaricom)
router.post('/mpesa/till', webhookController.mpesaTillWebhook);

// Bank Webhook (from bank integration)
router.post('/bank', webhookController.bankWebhook);

// ============================================================
// TEST WEBHOOK (For manual testing - requires auth)
// ============================================================

// Development only - can be removed in production
router.post('/test', webhookController.testWebhook);

module.exports = router;