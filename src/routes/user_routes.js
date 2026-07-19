const express = require('express');
const userController = require('../controllers/user_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

// ============================================================
// PUBLIC ROUTES (No auth required)
// ============================================================

// Accept invite - public endpoint
router.post('/invites/:token/accept', userController.acceptInvite);

// ============================================================
// PROTECTED ROUTES
// ============================================================

router.use(authenticate);

// ============================================================
// PROFILE
// ============================================================

router.get('/profile', userController.getProfile);
router.patch('/profile', userController.updateProfile);
router.post('/profile/phone/request', userController.requestPhoneChange);
router.post('/profile/phone/verify', userController.verifyPhoneChange);

// ============================================================
// NOTIFICATIONS
// ============================================================

router.get('/notifications', userController.getNotificationPreferences);
router.patch('/notifications', userController.updateNotificationPreferences);

// ============================================================
// INVITES (Owner only)
// ============================================================

router.get('/invites', requireRole('admin', 'owner'), userController.listInvites);
router.post('/invites', requireRole('admin', 'owner'), userController.inviteUser);
router.delete('/invites/:id', requireRole('admin', 'owner'), userController.cancelInvite);

// ============================================================
// AUDIT LOGS (Owner only)
// ============================================================

router.get('/audit-logs', requireRole('admin', 'owner'), userController.getAuditLogs);
router.get('/audit-logs/stats', requireRole('admin', 'owner'), userController.getAuditLogStats);

module.exports = router;