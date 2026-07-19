const express = require('express');
const mpesaController = require('../controllers/mpesa_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.post('/c2b/validation', mpesaController.c2bValidation);
router.post('/c2b/confirmation', mpesaController.c2bConfirmation);

router.post(
  '/accounts/:paymentAccountId/connect',
  authenticate,
  requireRole('owner', 'admin'),
  mpesaController.connectAccount
);

router.post(
  '/simulate',
  authenticate,
  requireRole('owner', 'admin'),
  mpesaController.simulatePayment
);

module.exports = router;