const express = require('express');
const paymentController = require('../controllers/payment_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// Unmatched payments
router.get('/unmatched', requireRole('admin', 'owner', 'caretaker'), paymentController.getUnmatchedPayments);

// Search tenants for matching
router.get('/search-tenants', requireRole('admin', 'owner'), paymentController.searchTenantsForMatching);

// Record auto-matched payment (simulates M-Pesa/Bank webhook)
router.post('/auto', requireRole('admin', 'owner', 'caretaker'), paymentController.recordAutoPayment);

// Match an unmatched payment
router.post('/:id/match', requireRole('admin', 'owner'), paymentController.matchPayment);

// Get payment details
router.get('/:id', requireRole('admin', 'owner', 'caretaker'), paymentController.getPaymentDetails);

module.exports = router;