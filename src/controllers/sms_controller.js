const smsBroadcastService = require('../services/sms_broadcast_service');
const {
  createTemplateSchema,
  updateTemplateSchema,
  createBroadcastSchema,
  updateBroadcastSchema,
  listBroadcastsQuerySchema,
  listMessagesQuerySchema,
  deliveryWebhookSchema,
} = require('../validators/sms_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

// ============================================================
// TEMPLATE CONTROLLERS
// ============================================================

async function listTemplates(req, res) {
  try {
    const templates = await smsBroadcastService.listTemplates(req.user);

    res.json({
      success: true,
      templates,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getTemplate(req, res) {
  try {
    const template = await smsBroadcastService.getTemplateById(req.user, req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found',
      });
    }

    res.json({
      success: true,
      template,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function createTemplate(req, res) {
  try {
    const data = createTemplateSchema.parse(req.body);
    const template = await smsBroadcastService.createTemplate(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'SMS template created successfully',
      template,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateTemplate(req, res) {
  try {
    const data = updateTemplateSchema.parse(req.body);
    const template = await smsBroadcastService.updateTemplate(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'SMS template updated successfully',
      template,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function deleteTemplate(req, res) {
  try {
    await smsBroadcastService.deleteTemplate(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'SMS template deleted successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// BROADCAST CONTROLLERS
// ============================================================

async function listBroadcasts(req, res) {
  try {
    const filters = listBroadcastsQuerySchema.parse(req.query);
    const result = await smsBroadcastService.listBroadcasts(req.user, filters);

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

async function getBroadcast(req, res) {
  try {
    const broadcast = await smsBroadcastService.getBroadcastById(req.user, req.params.id);

    if (!broadcast) {
      return res.status(404).json({
        success: false,
        error: 'Broadcast not found',
      });
    }

    res.json({
      success: true,
      broadcast,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function createBroadcast(req, res) {
  try {
    const data = createBroadcastSchema.parse(req.body);
    const broadcast = await smsBroadcastService.createBroadcast(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: broadcast.scheduled_at ? 'Broadcast scheduled successfully' : 'Broadcast sent successfully',
      broadcast,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateBroadcast(req, res) {
  try {
    const data = updateBroadcastSchema.parse(req.body);
    const broadcast = await smsBroadcastService.getBroadcastById(req.user, req.params.id);

    res.json({
      success: true,
      message: 'Broadcast updated successfully',
      broadcast,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function cancelBroadcast(req, res) {
  try {
    await smsBroadcastService.cancelBroadcast(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Broadcast cancelled successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// MESSAGE CONTROLLERS
// ============================================================

async function listMessages(req, res) {
  try {
    const filters = listMessagesQuerySchema.parse(req.query);
    const result = await smsBroadcastService.listMessages(req.user, filters);

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
// STATS CONTROLLERS
// ============================================================

async function getSmsStats(req, res) {
  try {
    const stats = await smsBroadcastService.getSmsStats(req.user);

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

// ============================================================
// WEBHOOK CONTROLLER
// ============================================================

async function deliveryWebhook(req, res) {
  try {
    const data = deliveryWebhookSchema.parse(req.body);
    const result = await smsBroadcastService.handleDeliveryWebhook(data, req.ip);

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

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listBroadcasts,
  getBroadcast,
  createBroadcast,
  updateBroadcast,
  cancelBroadcast,
  listMessages,
  getSmsStats,
  deliveryWebhook,
};