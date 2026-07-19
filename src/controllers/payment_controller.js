const paymentService = require('../services/payment_service');
const { 
  manualPaymentSchema,
  autoPaymentSchema,
  matchPaymentSchema,
  searchTenantsSchema,
} = require('../validators/payment_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function recordTenantManualPayment(req, res) {
  try {
    const data = manualPaymentSchema.parse(req.body);
    const payment = await paymentService.recordManualTenantPayment(
      req.user,
      req.params.id,
      data,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Manual payment recorded and allocated successfully',
      payment,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function recordAutoPayment(req, res) {
  try {
    const data = autoPaymentSchema.parse(req.body);
    const result = await paymentService.recordAutoPayment(
      req.user,
      data,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: result.message,
      payment: result.payment,
      allocation: result.allocation || null,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function listTenantPayments(req, res) {
  try {
    const payments = await paymentService.listTenantPayments(req.user, req.params.id);

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function getUnmatchedPayments(req, res) {
  try {
    const payments = await paymentService.getUnmatchedPayments(req.user);

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

async function matchPayment(req, res) {
  try {
    const data = matchPaymentSchema.parse(req.body);
    const payment = await paymentService.matchUnmatchedPayment(
      req.user,
      req.params.id,
      data,
      req.ip
    );

    res.json({
      success: true,
      message: 'Payment matched and allocated successfully',
      payment,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function searchTenantsForMatching(req, res) {
  try {
    const data = searchTenantsSchema.parse(req.query);
    const tenants = await paymentService.searchTenantsForMatching(
      req.user,
      data.search
    );

    res.json({
      success: true,
      tenants,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

async function getPaymentDetails(req, res) {
  try {
    const payment = await paymentService.getPaymentById(req.user, req.params.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
    }

    res.json({
      success: true,
      payment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  recordTenantManualPayment,
  recordAutoPayment,
  listTenantPayments,
  getUnmatchedPayments,
  matchPayment,
  searchTenantsForMatching,
  getPaymentDetails,
};