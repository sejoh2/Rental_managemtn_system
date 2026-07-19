const express = require('express');
const reportController = require('../controllers/report_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// ============================================================
// REPORT ENDPOINTS
// ============================================================

// Occupancy Report
router.get('/occupancy', requireRole('admin', 'owner', 'caretaker'), reportController.getOccupancyReport);

// Arrears Report
router.get('/arrears', requireRole('admin', 'owner'), reportController.getArrearsReport);

// Rent Collection Report
router.get('/rent-collection', requireRole('admin', 'owner'), reportController.getRentCollectionReport);

// Water Billing Report
router.get('/water-billing', requireRole('admin', 'owner'), reportController.getWaterBillingReport);

// SMS Usage Report
router.get('/sms-usage', requireRole('admin', 'owner'), reportController.getSmsUsageReport);

// Tenant Statement
router.get('/tenant-statement/:id', requireRole('admin', 'owner', 'caretaker'), reportController.getTenantStatement);

// Export Report
router.post('/export', requireRole('admin', 'owner'), reportController.exportReport);

// Report History
router.get('/history', requireRole('admin', 'owner'), reportController.getReportHistory);

// Download Report
router.get('/download/:id', requireRole('admin', 'owner'), reportController.downloadReport);

module.exports = router;