const express = require('express');
const tenantController = require('../controllers/tenant_controller');
const paymentController = require('../controllers/payment_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', requireRole('admin', 'owner', 'caretaker'), tenantController.listTenants);

// Tenant agreement
router.get('/:id/agreement', requireRole('admin', 'owner', 'caretaker'), tenantController.getTenantAgreement);

// Tenant payments
router.get('/:id/payments', requireRole('admin', 'owner', 'caretaker'), paymentController.listTenantPayments);

// Manual payment recording (for a specific tenant)
router.post('/:id/manual-payment', requireRole('admin', 'owner', 'caretaker'), paymentController.recordTenantManualPayment);

// Tenant CRUD
router.get('/:id', requireRole('admin', 'owner', 'caretaker'), tenantController.getTenant);
router.post('/', requireRole('admin', 'owner', 'caretaker'), tenantController.createTenant);
router.patch('/:id', requireRole('admin', 'owner', 'caretaker'), tenantController.updateTenant);
router.post('/:id/move-out', requireRole('admin', 'owner', 'caretaker'), tenantController.moveOutTenant);
router.delete('/:id', requireRole('admin', 'owner', 'caretaker'), tenantController.moveOutTenant);

module.exports = router;