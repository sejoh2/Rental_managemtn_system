const caretakerService = require('../services/caretaker_service');
const {
  createCaretakerSchema,
  updateCaretakerSchema,
  listCaretakersQuerySchema,
} = require('../validators/caretaker_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listCaretakers(req, res) {
  try {
    const filters = listCaretakersQuerySchema.parse(req.query);
    const result = await caretakerService.listCaretakers(req.user, filters);

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

async function getCaretaker(req, res) {
  try {
    const caretaker = await caretakerService.getCaretakerById(req.user, req.params.id);

    res.json({
      success: true,
      caretaker,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function createCaretaker(req, res) {
  try {
    const data = createCaretakerSchema.parse(req.body);
    const caretaker = await caretakerService.createCaretaker(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Caretaker added successfully',
      caretaker,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateCaretaker(req, res) {
  try {
    const data = updateCaretakerSchema.parse(req.body);
    const caretaker = await caretakerService.updateCaretaker(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Caretaker updated successfully',
      caretaker,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function deleteCaretaker(req, res) {
  try {
    await caretakerService.deleteCaretaker(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Caretaker removed successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getAvailableProperties(req, res) {
  try {
    const properties = await caretakerService.getAvailableProperties(req.user);

    res.json({
      success: true,
      properties,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getCaretakerActivity(req, res) {
  try {
    const activity = await caretakerService.getCaretakerActivity(req.user, req.params.id);

    res.json({
      success: true,
      activity,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getPermissionLevels(req, res) {
  try {
    const levels = await caretakerService.getPermissionLevels();

    res.json({
      success: true,
      levels,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  listCaretakers,
  getCaretaker,
  createCaretaker,
  updateCaretaker,
  deleteCaretaker,
  getAvailableProperties,
  getCaretakerActivity,
  getPermissionLevels,
};