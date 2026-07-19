const daraja = require('../utils/daraja');
const webhookService = require('../services/webhook_service');
const { logAudit } = require('../services/audit_service');

/**
 * C2B Confirmation Callback (Called by Safaricom)
 * This is where Safaricom sends payment confirmations
 */
async function c2bConfirmation(req, res) {
  try {
    console.log('[DARAJA C2B] 📥 Confirmation received:', JSON.stringify(req.body, null, 2));

    const {
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber,
      MSISDN,
      FirstName,
      LastName,
      TransID,
      OrgAccountBalance,
      ThirdPartyTransID,
    } = req.body;

    // Validate required fields
    if (!TransAmount || !BusinessShortCode || !MSISDN) {
      console.log('[DARAJA C2B] ❌ Missing required fields');
      return res.status(200).json({
        ResponseCode: '00000001',
        ResponseDesc: 'Missing required fields',
      });
    }

    // Convert to the format our webhook service expects
    // This reuses your existing payment processing logic
    const paymentData = {
      TransTime: TransTime || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
      TransAmount: TransAmount,
      BusinessShortCode: BusinessShortCode,
      BillRefNumber: BillRefNumber || 'RENT-PAYMENT',
      MSISDN: MSISDN,
      FirstName: FirstName || 'Customer',
      LastName: LastName || '',
      TransID: TransID || `MPESA-${Date.now()}`,
    };

    console.log('[DARAJA C2B] 📤 Processing payment with data:', paymentData);

    // Process the payment using the existing webhook service
    const result = await webhookService.handleMpesaPaybillWebhook(paymentData, req.ip);

    // Log the transaction
    await logAudit({
      userId: null,
      action: 'C2B_PAYMENT_RECEIVED',
      entityType: 'payment',
      metadata: {
        transId: TransID,
        amount: TransAmount,
        phone: MSISDN,
        billRef: BillRefNumber,
        businessShortCode: BusinessShortCode,
        matched: result.payment?.status === 'matched',
        tenantId: result.payment?.tenant_id,
        tenantName: result.payment?.tenant_name,
      },
      ipAddress: req.ip,
    });

    console.log('[DARAJA C2B] ✅ Payment processed:', {
      amount: TransAmount,
      phone: MSISDN,
      billRef: BillRefNumber,
      status: result.payment?.status,
      tenant: result.payment?.tenant_name || 'Not matched',
    });

    // Always return success to Safaricom
    res.status(200).json({
      ResponseCode: '00000000',
      ResponseDesc: 'Success',
    });

  } catch (error) {
    console.error('[DARAJA C2B] ❌ Error processing confirmation:', error.message);
    // Always return 200 to Safaricom
    res.status(200).json({
      ResponseCode: '00000001',
      ResponseDesc: 'Error processing payment',
    });
  }
}

/**
 * C2B Validation Callback (Called by Safaricom before confirmation)
 * Used to validate the transaction before it completes
 */
async function c2bValidation(req, res) {
  try {
    console.log('[DARAJA C2B] 📥 Validation received:', JSON.stringify(req.body, null, 2));

    const {
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber,
      MSISDN,
      TransID,
    } = req.body;

    // You can add validation logic here:
    // - Check if the BillRefNumber is valid
    // - Check if the amount is within limits
    // - Check if the tenant exists

    let isValid = true;
    let reason = 'Success';

    // Example: Check if BillRefNumber exists
    if (BillRefNumber) {
      const result = await db.query(
        `
        SELECT t.id, t.full_name
        FROM tenants t
        WHERE t.rent_bank_reference = $1 
           OR t.id_number = $1
           OR t.unit_number = $1
          AND t.status = 'active'
        LIMIT 1
        `,
        [BillRefNumber]
      );

      if (!result.rows[0]) {
        isValid = false;
        reason = 'Invalid account reference';
        console.log('[DARAJA C2B] ❌ Validation failed: Account reference not found');
      } else {
        console.log('[DARAJA C2B] ✅ Validation passed for tenant:', result.rows[0].full_name);
      }
    }

    // Log validation attempt
    await logAudit({
      userId: null,
      action: 'C2B_VALIDATION',
      entityType: 'payment',
      metadata: {
        transId: TransID,
        amount: TransAmount,
        phone: MSISDN,
        billRef: BillRefNumber,
        isValid: isValid,
        reason: reason,
      },
      ipAddress: req.ip,
    });

    // Return response to Safaricom
    res.status(200).json({
      ResponseCode: isValid ? '00000000' : '00000001',
      ResponseDesc: isValid ? 'Success' : `Validation failed: ${reason}`,
    });

  } catch (error) {
    console.error('[DARAJA C2B] ❌ Error in validation:', error.message);
    res.status(200).json({
      ResponseCode: '00000001',
      ResponseDesc: 'Error validating transaction',
    });
  }
}

/**
 * Register C2B URLs with Daraja
 * Call this to register your confirmation/validation endpoints
 */
async function registerC2BUrls(req, res) {
  try {
    const { confirmationUrl, validationUrl } = req.body;

    const result = await daraja.registerC2BUrls(confirmationUrl, validationUrl);

    if (result.success) {
      console.log('[DARAJA] ✅ C2B URLs registered successfully');
      res.json({
        success: true,
        responseCode: result.responseCode,
        responseDescription: result.responseDescription,
      });
    } else {
      console.error('[DARAJA] ❌ Failed to register C2B URLs:', result.error);
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[DARAJA] ❌ Register error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Simulate C2B Payment (Sandbox only)
 * Used for testing without real money
 */
async function simulateC2BPayment(req, res) {
  try {
    const { phoneNumber, amount, billRefNumber } = req.body;

    if (!phoneNumber || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and amount are required',
      });
    }

    const result = await daraja.simulateC2BPayment({
      phoneNumber,
      amount,
      billRefNumber: billRefNumber || 'TEST',
    });

    if (result.success) {
      res.json({
        success: true,
        responseCode: result.responseCode,
        responseDescription: result.responseDescription,
        transactionId: result.transactionId,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[DARAJA] ❌ Simulate error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  c2bConfirmation,
  c2bValidation,
  registerC2BUrls,
  simulateC2BPayment,
};