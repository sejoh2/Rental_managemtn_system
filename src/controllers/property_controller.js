const propertyService = require('../services/property_service');
const {
  createPropertySchema,
  updatePropertySchema,
} = require('../validators/property_validator');

async function listProperties(req, res) {
  try {
    const properties = await propertyService.listProperties(req.user);

    res.json({
      success: true,
      properties,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function getProperty(req, res) {
  try {
    const property = await propertyService.getPropertyById(req.user, req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    res.json({
      success: true,
      property,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function createProperty(req, res) {
  try {
    const data = createPropertySchema.parse(req.body);
    const property = await propertyService.createProperty(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      property,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.errors ? error.errors[0].message : error.message,
    });
  }
}

async function updateProperty(req, res) {
  try {
    const data = updatePropertySchema.parse(req.body);
    const property = await propertyService.updateProperty(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Property updated successfully',
      property,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.errors ? error.errors[0].message : error.message,
    });
  }
}

async function archiveProperty(req, res) {
  try {
    await propertyService.archiveProperty(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Property archived successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  listProperties,
  getProperty,
  createProperty,
  updateProperty,
  archiveProperty,
};