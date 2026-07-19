const webhookService = require('../services/webhook_service');

// ============================================================
// MPESA PAYBILL WEBHOOK
// ============================================================

async function mpesaPaybillWebhook(req, res) {
  try {
    const signature = req.headers['x-signature'];
    const rawBody = JSON.stringify(req.body);

    const result = await webhookService.handleMpesaPaybillWebhook(
      req.body, 
      req.ip,
      rawBody,
      signature
    );

    // Always return 200 OK to M-Pesa
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.payment,
    });
  } catch (error) {
    console.error('[MPESA PAYBILL WEBHOOK ERROR]', error.message);
    res.status(200).json({
      success: false,
      message: 'Error processing payment',
      error: error.message,
    });
  }
}

// ============================================================
// MPESA TILL WEBHOOK
// ============================================================

async function mpesaTillWebhook(req, res) {
  try {
    const signature = req.headers['x-signature'];
    const rawBody = JSON.stringify(req.body);

    const result = await webhookService.handleMpesaTillWebhook(
      req.body,
      req.ip,
      rawBody,
      signature
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.payment,
    });
  } catch (error) {
    console.error('[MPESA TILL WEBHOOK ERROR]', error.message);
    res.status(200).json({
      success: false,
      message: 'Error processing payment',
      error: error.message,
    });
  }
}

// ============================================================
// BANK WEBHOOK
// ============================================================

async function bankWebhook(req, res) {
  try {
    const result = await webhookService.handleBankWebhook(req.body, req.ip);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.payment,
    });
  } catch (error) {
    console.error('[BANK WEBHOOK ERROR]', error.message);
    res.status(200).json({
      success: false,
      message: 'Error processing payment',
      error: error.message,
    });
  }
}

// ============================================================
// TEST WEBHOOK (For manual testing - dev only)
// ============================================================

async function testWebhook(req, res) {
  try {
    const { type, data } = req.body;

    let result;
    switch (type) {
      case 'mpesa_paybill':
        result = await webhookService.handleMpesaPaybillWebhook(data, req.ip);
        break;
      case 'mpesa_till':
        result = await webhookService.handleMpesaTillWebhook(data, req.ip);
        break;
      case 'bank':
        result = await webhookService.handleBankWebhook(data, req.ip);
        break;
      default:
        throw new Error('Invalid webhook type');
    }

    res.json({
      success: true,
      message: 'Test webhook processed',
      result: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  mpesaPaybillWebhook,
  mpesaTillWebhook,
  bankWebhook,
  testWebhook,
};