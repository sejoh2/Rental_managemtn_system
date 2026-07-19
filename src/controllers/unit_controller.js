const unitService = require('../services/unit_service');
const {
  createUnitSchema,
  updateUnitSchema,
  listUnitsQuerySchema,
} = require('../validators/unit_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listUnits(req, res) {
  try {
    const filters = listUnitsQuerySchema.parse(req.query);
    const result = await unitService.listUnits(req.user, filters);

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

async function getUnit(req, res) {
  try {
    const unit = await unitService.getUnitById(req.user, req.params.id);

    if (!unit) {
      return res.status(404).json({
        success: false,
        error: 'Unit not found',
      });
    }

    res.json({
      success: true,
      unit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function createUnit(req, res) {
  try {
    const data = createUnitSchema.parse(req.body);
    const unit = await unitService.createUnit(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      unit,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateUnit(req, res) {
  try {
    const data = updateUnitSchema.parse(req.body);
    const unit = await unitService.updateUnit(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Unit updated successfully',
      unit,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function archiveUnit(req, res) {
  try {
    await unitService.archiveUnit(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Unit archived successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  listUnits,
  getUnit,
  createUnit,
  updateUnit,
  archiveUnit,
};