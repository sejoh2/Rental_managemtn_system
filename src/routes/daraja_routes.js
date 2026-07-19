const express = require('express');
const darajaController = require('../controllers/daraja_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

// ============================================================
// PUBLIC WEBHOOKS (Called by Safaricom - No Auth)
// ============================================================

// C2B Confirmation Callback - NEW PATH WITH /v2
router.post('/c2b/confirmation/v2', darajaController.c2bConfirmation);

// C2B Validation Callback - NEW PATH WITH /v2
router.post('/c2b/validation/v2', darajaController.c2bValidation);

// ============================================================
// PROTECTED ROUTES (Admin/Owner only)
// ============================================================

// Register C2B URLs with Daraja
router.post('/register', authenticate, requireRole('admin', 'owner'), darajaController.registerC2BUrls);

// Simulate C2B Payment (Sandbox only)
router.post('/simulate', authenticate, requireRole('admin', 'owner'), darajaController.simulateC2BPayment);

module.exports = router;