const mpesaService = require('../services/mpesa_service');

async function connectAccount(req, res) {
  try {
    const paymentAccount = await mpesaService.connectMpesaAccount(
      req.user,
      Number(req.params.paymentAccountId),
      req.ip
    );

    res.json({
      success: true,
      message: 'M-Pesa account connected and callback registered',
      data: paymentAccount,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function simulatePayment(req, res) {
  try {
    const result = await mpesaService.simulateMpesaPayment(
      req.user,
      req.body,
      req.ip
    );

    res.json({
      success: true,
      message: 'Sandbox payment simulation submitted',
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function c2bValidation(req, res) {
  await mpesaService.validateC2BPayment(req.body, req.ip);

  res.status(200).json({
    ResponseCode: '00000000',
    ResponseDesc: 'Accepted',
  });
}

async function c2bConfirmation(req, res) {
  try {
    await mpesaService.processC2BConfirmation(req.body, req.ip);

    res.status(200).json({
      ResponseCode: '00000000',
      ResponseDesc: 'Success',
    });
  } catch (error) {
    console.error('M-Pesa confirmation error:', error.message);

    res.status(200).json({
      ResponseCode: '00000000',
      ResponseDesc: 'Accepted for review',
    });
  }
}

module.exports = {
  connectAccount,
  simulatePayment,
  c2bValidation,
  c2bConfirmation,
};