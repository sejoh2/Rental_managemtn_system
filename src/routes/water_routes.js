const express = require('express');
const waterController = require('../controllers/water_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// Meter readings
router.post('/readings', requireRole('admin', 'owner', 'caretaker'), waterController.submitMeterReading);
router.get('/readings/pending', requireRole('admin', 'owner'), waterController.getPendingReadings);
router.patch('/readings/:id/approve', requireRole('admin', 'owner'), waterController.approveReading);

// Water bills
router.get('/tenants/:id/bills', requireRole('admin', 'owner', 'caretaker'), waterController.getTenantWaterBills);
router.get('/units/:id/bills', requireRole('admin', 'owner', 'caretaker'), waterController.getUnitWaterBills);

// Water rules - FIXED: These routes now correctly reference the controller
router.get('/rules/:id', requireRole('admin', 'owner'), waterController.getWaterRules);
router.patch('/rules/:id', requireRole('admin', 'owner'), waterController.updateWaterRules);
router.get('/rules/all', requireRole('admin', 'owner'), waterController.getAllWaterRules);

// Stats
router.get('/stats', requireRole('admin', 'owner', 'caretaker'), waterController.getWaterStats);

module.exports = router;