const express = require('express');
const maintenanceController = require('../controllers/maintenance_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// Categories (everyone can view)
router.get('/categories', requireRole('admin', 'owner', 'caretaker'), maintenanceController.getMaintenanceCategories);

// Stats (everyone can view)
router.get('/stats', requireRole('admin', 'owner', 'caretaker'), maintenanceController.getMaintenanceStats);

// CRUD - Everyone can create and view
router.get('/', requireRole('admin', 'owner', 'caretaker'), maintenanceController.listMaintenance);
router.post('/', requireRole('admin', 'owner', 'caretaker'), maintenanceController.createMaintenance);
router.get('/:id', requireRole('admin', 'owner', 'caretaker'), maintenanceController.getMaintenance);

// Status updates - Everyone can update status (with permissions in service)
router.patch('/:id/status', requireRole('admin', 'owner', 'caretaker'), maintenanceController.updateStatus);

// Assign - Only owner/admin can assign
router.patch('/:id/assign', requireRole('admin', 'owner'), maintenanceController.assignMaintenance);

// Full update - Only owner/admin
router.patch('/:id', requireRole('admin', 'owner'), maintenanceController.updateMaintenance);

module.exports = router;