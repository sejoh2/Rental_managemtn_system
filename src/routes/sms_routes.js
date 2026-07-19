const express = require('express');
const smsController = require('../controllers/sms_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// ============================================================
// PUBLIC WEBHOOKS (No auth required - called by Africa's Talking)
// ============================================================
router.post('/webhooks/delivery', smsController.deliveryWebhook);

// ============================================================
// TEMPLATES
// ============================================================
router.get('/templates', requireRole('admin', 'owner'), smsController.listTemplates);
router.post('/templates', requireRole('admin', 'owner'), smsController.createTemplate);
router.get('/templates/:id', requireRole('admin', 'owner'), smsController.getTemplate);
router.patch('/templates/:id', requireRole('admin', 'owner'), smsController.updateTemplate);
router.delete('/templates/:id', requireRole('admin', 'owner'), smsController.deleteTemplate);

// ============================================================
// BROADCASTS
// ============================================================
router.get('/broadcasts', requireRole('admin', 'owner'), smsController.listBroadcasts);
router.post('/broadcasts', requireRole('admin', 'owner'), smsController.createBroadcast);
router.get('/broadcasts/:id', requireRole('admin', 'owner'), smsController.getBroadcast);
router.patch('/broadcasts/:id', requireRole('admin', 'owner'), smsController.updateBroadcast);
router.post('/broadcasts/:id/cancel', requireRole('admin', 'owner'), smsController.cancelBroadcast);

// ============================================================
// MESSAGES
// ============================================================
router.get('/messages', requireRole('admin', 'owner'), smsController.listMessages);

// ============================================================
// STATS
// ============================================================
router.get('/stats', requireRole('admin', 'owner'), smsController.getSmsStats);

module.exports = router;