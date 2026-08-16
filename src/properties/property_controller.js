const property_service = require("./property_service");

async function list_properties(req, res, next) {
  try {
    const properties = await property_service.list_properties(
      req.user
    );

    return res.status(200).json({
      success: true,
      data: properties,
    });
  } catch (error) {
    next(error);
  }
}

async function get_property(req, res, next) {
  try {
    const property =
      await property_service.get_property_by_id(
        req.user,
        Number(req.params.property_id)
      );

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: property,
    });
  } catch (error) {
    next(error);
  }
} 
async function create_property(req, res, next) {
  try {
    const property =
      await property_service.create_property(
        req.user,
        req.body,
        req.ip
      );

    return res.status(201).json({
      success: true,
      message: "Property created successfully.",
      data: property,
    });
  } catch (error) {
    next(error);
  }
}

async function update_property(req, res, next) {
  try {
    const property =
      await property_service.update_property(
        req.user,
        Number(req.params.property_id),
        req.body,
        req.ip
      );

    return res.status(200).json({
      success: true,
      message: "Property updated successfully.",
      data: property,
    });
  } catch (error) {
    next(error);
  }
} 
async function archive_property(req, res, next) {
  try {
    const result =
      await property_service.archive_property(
        req.user,
        Number(req.params.property_id),
        req.ip
      );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list_properties,
  get_property,
  create_property,
  update_property,
  archive_property,
};