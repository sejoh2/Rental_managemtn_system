const maintenanceService = require('../services/maintenance_service');
const {
  createMaintenanceSchema,
  updateMaintenanceSchema,
  updateStatusSchema,
  assignMaintenanceSchema,
  listMaintenanceQuerySchema,
  maintenanceStatsSchema,
} = require('../validators/maintenance_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listMaintenance(req, res) {
  try {
    const filters = listMaintenanceQuerySchema.parse(req.query);
    const result = await maintenanceService.listMaintenance(req.user, filters);

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

async function createMaintenance(req, res) {
  try {
    const data = createMaintenanceSchema.parse(req.body);
    const request = await maintenanceService.createMaintenance(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Maintenance request created successfully',
      request,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getMaintenance(req, res) {
  try {
    const request = await maintenanceService.getMaintenanceById(req.user, req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance request not found',
      });
    }

    res.json({
      success: true,
      request,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function updateMaintenance(req, res) {
  try {
    const data = updateMaintenanceSchema.parse(req.body);
    const request = await maintenanceService.updateMaintenance(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Maintenance request updated successfully',
      request,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateStatus(req, res) {
  try {
    const data = updateStatusSchema.parse(req.body);
    const request = await maintenanceService.updateStatus(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: `Maintenance status updated to ${data.status}`,
      request,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function assignMaintenance(req, res) {
  try {
    const data = assignMaintenanceSchema.parse(req.body);
    const request = await maintenanceService.assignMaintenance(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Maintenance request assigned successfully',
      request,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getMaintenanceStats(req, res) {
  try {
    const filters = maintenanceStatsSchema.parse(req.query);
    const stats = await maintenanceService.getMaintenanceStats(req.user, filters);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getMaintenanceCategories(req, res) {
  try {
    const categories = await maintenanceService.getMaintenanceCategories();

    res.json({
      success: true,
      categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  listMaintenance,
  createMaintenance,
  getMaintenance,
  updateMaintenance,
  updateStatus,
  assignMaintenance,
  getMaintenanceStats,
  getMaintenanceCategories,
};