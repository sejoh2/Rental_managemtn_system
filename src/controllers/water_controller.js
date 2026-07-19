const waterService = require('../services/water_service');
const {
  meterReadingSchema,
  approveReadingSchema,
  generateBillSchema,
  updateBillSchema,
  waterRulesSchema,
} = require('../validators/water_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

// ============================================================
// METER READING FUNCTIONS
// ============================================================

async function submitMeterReading(req, res) {
  try {
    const data = meterReadingSchema.parse(req.body);
    const reading = await waterService.submitMeterReading(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Meter reading submitted successfully',
      reading,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getPendingReadings(req, res) {
  try {
    const readings = await waterService.getPendingReadings(req.user);

    res.json({
      success: true,
      readings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function approveReading(req, res) {
  try {
    const data = approveReadingSchema.parse(req.body);
    const result = await waterService.approveReading(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: result.message,
      bill: result.bill || null,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// WATER BILL FUNCTIONS
// ============================================================

async function getTenantWaterBills(req, res) {
  try {
    const bills = await waterService.getTenantWaterBills(req.user, req.params.id);

    res.json({
      success: true,
      bills,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getUnitWaterBills(req, res) {
  try {
    const bills = await waterService.getUnitWaterBills(req.user, req.params.id);

    res.json({
      success: true,
      bills,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// WATER RULES FUNCTIONS
// ============================================================

async function getWaterRules(req, res) {
  try {
    const rules = await waterService.getWaterRules(req.user, req.params.id);

    res.json({
      success: true,
      rules,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function updateWaterRules(req, res) {
  try {
    const data = waterRulesSchema.parse(req.body);
    const rules = await waterService.updateWaterRules(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Water billing rules updated successfully',
      rules,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getAllWaterRules(req, res) {
  try {
    const rules = await waterService.getAllWaterRules(req.user);

    res.json({
      success: true,
      rules,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// STATS FUNCTIONS
// ============================================================

async function getWaterStats(req, res) {
  try {
    const stats = await waterService.getWaterStats(req.user);

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
  submitMeterReading,
  getPendingReadings,
  approveReading,
  getTenantWaterBills,
  getUnitWaterBills,
  getWaterRules,
  updateWaterRules,
  getAllWaterRules,
  getWaterStats,
};