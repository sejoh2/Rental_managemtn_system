const agreementService = require('../services/agreement_service');
const { agreementTemplateSchema } = require('../validators/agreement_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listTemplates(req, res) {
  try {
    const templates = await agreementService.listTemplates(req.user);

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

async function saveTemplate(req, res) {
  try {
    const data = agreementTemplateSchema.parse(req.body);
    const template = await agreementService.saveTemplate(req.user, data, req.ip);

    res.json({
      success: true,
      message: 'Agreement template saved successfully',
      template,
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
  saveTemplate,
};