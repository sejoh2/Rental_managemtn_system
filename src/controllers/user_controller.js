const userService = require('../services/user_service');
const {
  updateProfileSchema,
  updatePhoneSchema,
  notificationPreferencesSchema,
  inviteUserSchema,
  listAuditLogsSchema,
  listInvitesSchema,
} = require('../validators/user_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

// ============================================================
// PROFILE CONTROLLERS
// ============================================================

async function getProfile(req, res) {
  try {
    const profile = await userService.getProfile(req.user);

    res.json({
      success: true,
      user: profile,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function updateProfile(req, res) {
  try {
    const data = updateProfileSchema.parse(req.body);
    const profile = await userService.updateProfile(req.user, data, req.ip);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: profile,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function requestPhoneChange(req, res) {
  try {
    const data = updatePhoneSchema.parse(req.body);
    const result = await userService.requestPhoneChange(req.user, data.phone, req.ip);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function verifyPhoneChange(req, res) {
  try {
    const data = updatePhoneSchema.parse(req.body);
    const result = await userService.verifyPhoneChange(req.user, data.phone, data.code, req.ip);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// NOTIFICATION CONTROLLERS
// ============================================================

async function getNotificationPreferences(req, res) {
  try {
    const preferences = await userService.getNotificationPreferences(req.user);

    res.json({
      success: true,
      preferences,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function updateNotificationPreferences(req, res) {
  try {
    const data = notificationPreferencesSchema.parse(req.body);
    const preferences = await userService.updateNotificationPreferences(req.user, data, req.ip);

    res.json({
      success: true,
      message: 'Notification preferences updated successfully',
      preferences,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// INVITE CONTROLLERS
// ============================================================

async function inviteUser(req, res) {
  try {
    const data = inviteUserSchema.parse(req.body);
    const result = await userService.inviteUser(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'User invited successfully',
      invite: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function listInvites(req, res) {
  try {
    const filters = listInvitesSchema.parse(req.query);
    const result = await userService.listInvites(req.user, filters);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function cancelInvite(req, res) {
  try {
    await userService.cancelInvite(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Invite cancelled successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// Public endpoint - no auth required
async function acceptInvite(req, res) {
  try {
    const { token } = req.params;
    const data = req.body;
    const result = await userService.acceptInvite(token, data, req.ip);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// AUDIT LOG CONTROLLERS
// ============================================================

async function getAuditLogs(req, res) {
  try {
    const filters = listAuditLogsSchema.parse(req.query);
    const result = await userService.getAuditLogs(req.user, filters);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getAuditLogStats(req, res) {
  try {
    const stats = await userService.getAuditLogStats(req.user);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  requestPhoneChange,
  verifyPhoneChange,
  getNotificationPreferences,
  updateNotificationPreferences,
  inviteUser,
  listInvites,
  cancelInvite,
  acceptInvite,
  getAuditLogs,
  getAuditLogStats,
};