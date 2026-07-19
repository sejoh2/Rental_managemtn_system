const tenantService = require('../services/tenant_service');
const agreementService = require('../services/agreement_service');
const {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  moveOutTenantSchema,
} = require('../validators/tenant_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listTenants(req, res) {
  try {
    const filters = listTenantsQuerySchema.parse(req.query);
    const result = await tenantService.listTenants(req.user, filters);

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

async function getTenant(req, res) {
  try {
    const tenant = await tenantService.getTenantById(req.user, req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    res.json({
      success: true,
      tenant,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function getTenantAgreement(req, res) {
  try {
    const agreement = await agreementService.generateTenantAgreement(req.user, req.params.id);

    res.json({
      success: true,
      agreement,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function createTenant(req, res) {
  try {
    const data = createTenantSchema.parse(req.body);
    const tenant = await tenantService.createTenant(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      tenant,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function updateTenant(req, res) {
  try {
    const data = updateTenantSchema.parse(req.body);
    const tenant = await tenantService.updateTenant(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Tenant updated successfully',
      tenant,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function moveOutTenant(req, res) {
  try {
    const data = moveOutTenantSchema.parse(req.body);
    await tenantService.moveOutTenant(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Tenant moved out and archived successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

module.exports = {
  listTenants,
  getTenant,
  getTenantAgreement,
  createTenant,
  updateTenant,
  moveOutTenant,
};