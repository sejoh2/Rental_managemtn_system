const db = require('../config/db');
const crypto = require('crypto');
const { logAudit } = require('./audit_service');
const { normalizePhone } = require('../utils/phone');

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

// ============================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================

function verifyWebhookSignature(apiKey, signature, rawRequestBody) {
  if (!signature || !apiKey) {
    console.log('[WEBHOOK] Missing signature or API key');
    return false;
  }

  try {
    const computedSignature = crypto
      .createHmac('sha256', apiKey)
      .update(rawRequestBody)
      .digest('hex');

    const isValid = computedSignature === signature;
    console.log('[WEBHOOK] Signature valid:', isValid);
    return isValid;
  } catch (error) {
    console.error('[WEBHOOK] Signature verification error:', error.message);
    return false;
  }
}

// ============================================================
// MPESA PAYBILL WEBHOOK
// ============================================================

async function handleMpesaPaybillWebhook(data, ipAddress, rawBody = null, signature = null) {
  console.log('[MPESA PAYBILL WEBHOOK] Received:', data);

  // Verify signature if provided
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  if (signature && apiKey && rawBody) {
    const isValid = verifyWebhookSignature(apiKey, signature, rawBody);
    if (!isValid) {
      console.log('[MPESA] ❌ Invalid webhook signature');
      return {
        success: false,
        message: 'Invalid webhook signature',
        payment: { status: 'rejected', reason: 'invalid_signature' }
      };
    }
    console.log('[MPESA] ✅ Webhook signature verified');
  }

  // Validate required fields
  const requiredFields = ['TransAmount', 'BusinessShortCode', 'BillRefNumber', 'MSISDN', 'TransID'];
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const amount = Number(data.TransAmount);
  const rawPhone = data.MSISDN;
  const businessNumber = data.BusinessShortCode;
  const accountNumber = data.BillRefNumber;
  const reference = data.TransID;

  // Normalize phone
  const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
  const phoneWithoutPlus = phone.replace(/^\+/, '');

  console.log('[MPESA] Parsed:', { amount, phone, phoneWithoutPlus, businessNumber, accountNumber, reference });

  if (!amount || amount <= 0) {
    throw new Error('Invalid amount');
  }

  if (!phone) {
    throw new Error('Invalid phone number');
  }

  // Step 1: Find the property by payment account
  const propertyResult = await db.query(
    `
    SELECT p.*
    FROM properties p
    INNER JOIN payment_accounts pa ON pa.property_id = p.id
    WHERE pa.account_for = 'rent'
      AND pa.account_type = 'mpesa_paybill'
      AND pa.business_number = $1
      AND pa.account_number = $2
      AND pa.status = 'active'
      AND p.status = 'active'
    `,
    [businessNumber, accountNumber]
  );

  console.log('[MPESA] Property found:', propertyResult.rows[0] ? `YES (ID: ${propertyResult.rows[0]?.id})` : 'NO');

  if (!propertyResult.rows[0]) {
    await logUnmatchedPayment({
      source: 'mpesa_paybill',
      amount: amount,
      phone: phone,
      reference: reference,
      business_number: businessNumber,
      account_number: accountNumber,
      raw_data: data,
      ip_address: ipAddress,
    });
    
    return {
      success: false,
      message: 'Property not found for this payment account',
      payment: { status: 'unmatched', reason: 'property_not_found' }
    };
  }

  const property = propertyResult.rows[0];

  // Step 2: Find tenant by phone number
  const tenantResult = await db.query(
    `
    SELECT 
      t.id, 
      t.full_name, 
      t.owner_id, 
      t.property_id, 
      t.unit_id,
      t.phone as tenant_phone
    FROM tenants t
    WHERE t.status != 'archived'
      AND t.property_id = $1
      AND t.owner_id = $2
      AND (
        t.phone = $3
        OR t.phone = $4
        OR t.phone = $5
        OR t.phone LIKE '%' || $6
      )
    LIMIT 1
    `,
    [
      property.id, 
      property.owner_id, 
      phone,           // +254768453840
      phoneWithoutPlus, // 254768453840
      `+${phoneWithoutPlus}`, // +254768453840
      phoneWithoutPlus.substring(phoneWithoutPlus.length - 9) // 768453840
    ]
  );

  let tenantId = null;
  let tenant = null;

  if (tenantResult.rows[0]) {
    tenant = tenantResult.rows[0];
    tenantId = tenant.id;
    console.log('[MPESA] Tenant found by phone:', tenant.full_name, 'ID:', tenantId);
  }

  // If not found by phone, try payment identities
  if (!tenantId) {
    const identityResult = await db.query(
      `
      SELECT DISTINCT 
        t.id, 
        t.full_name, 
        t.owner_id, 
        t.property_id, 
        t.unit_id
      FROM tenants t
      INNER JOIN tenant_payment_identities pi ON pi.tenant_id = t.id
      WHERE t.status != 'archived'
        AND t.property_id = $1
        AND t.owner_id = $2
        AND pi.payment_channel = 'mpesa_phone'
        AND pi.status = 'active'
        AND (
          pi.normalized_value = $3
          OR pi.normalized_value = $4
          OR pi.raw_value = $5
        )
      LIMIT 1
      `,
      [property.id, property.owner_id, phone, phoneWithoutPlus, phoneWithoutPlus]
    );

    if (identityResult.rows[0]) {
      tenant = identityResult.rows[0];
      tenantId = tenant.id;
      console.log('[MPESA] Tenant found by payment identity:', tenant.full_name, 'ID:', tenantId);
    }
  }

  // Step 3: If tenant found, allocate payment; else create unmatched
  let paymentResult;
  let status = 'unmatched';

  if (tenantId) {
    console.log('[MPESA] ✅ Allocating payment to tenant:', tenant.full_name);
    
    const allocation = await allocatePaymentFromWebhook({
      tenantId: tenantId,
      amount: amount,
      paymentMethod: 'mpesa_auto',
      reference: reference,
      phone: phone,
      notes: `M-Pesa Paybill payment from ${phone} - ${reference}`,
      propertyId: property.id,
      ownerId: property.owner_id,
      unitId: tenant.unit_id,
      ipAddress: ipAddress,
    });

    paymentResult = allocation;
    status = 'matched';
    console.log('[MPESA] ✅ Payment allocated successfully');
  } else {
    console.log('[MPESA] ❌ No tenant found - creating unmatched payment');
    
    const unmatchedResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by
      )
      VALUES ($1, $2, $3, 'mpesa_auto', 'rent_balance', 'mpesa_auto', $4, $5, $6, CURRENT_TIMESTAMP, 'unmatched', NULL)
      RETURNING *
      `,
      [
        property.owner_id,
        property.id,
        amount,
        phone,
        reference,
        `M-Pesa Paybill payment - no matching tenant found. Phone: ${phone}, Business: ${businessNumber}, Account: ${accountNumber}`,
      ]
    );
    paymentResult = unmatchedResult.rows[0];
    console.log('[MPESA] ✅ Payment created as unmatched, ID:', paymentResult.id);
  }

  // Step 4: Log audit
  await logAudit({
    userId: null,
    action: status === 'matched' ? 'PAYMENT_AUTO_MATCHED' : 'PAYMENT_RECEIVED_UNMATCHED',
    entityType: 'payment',
    entityId: paymentResult.id,
    metadata: {
      source: 'mpesa_paybill',
      amount: amount,
      phone: phone,
      reference: reference,
      business_number: businessNumber,
      account_number: accountNumber,
      tenant_id: tenantId,
      matched: status === 'matched',
      signature_verified: signature ? true : false,
    },
    ipAddress,
  });

  return {
    success: true,
    message: status === 'matched' ? 'Payment processed successfully' : 'Payment received - needs manual matching',
    payment: {
      id: paymentResult.id,
      amount: amount,
      amount_display: formatMoney(amount),
      phone: phone,
      reference: reference,
      status: status,
      tenant_id: tenantId,
      tenant_name: tenant ? tenant.full_name : null,
    },
  };
}

// ============================================================
// MPESA TILL WEBHOOK (with signature verification)
// ============================================================

async function handleMpesaTillWebhook(data, ipAddress, rawBody = null, signature = null) {
  console.log('[MPESA TILL WEBHOOK] Received:', data);

  // Verify signature if provided
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  if (signature && apiKey && rawBody) {
    const isValid = verifyWebhookSignature(apiKey, signature, rawBody);
    if (!isValid) {
      console.log('[MPESA TILL] ❌ Invalid webhook signature');
      return {
        success: false,
        message: 'Invalid webhook signature',
        payment: { status: 'rejected', reason: 'invalid_signature' }
      };
    }
    console.log('[MPESA TILL] ✅ Webhook signature verified');
  }

  const requiredFields = ['TransAmount', 'TillNumber', 'MSISDN', 'TransID'];
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const amount = Number(data.TransAmount);
  const rawPhone = data.MSISDN;
  const tillNumber = data.TillNumber;
  const reference = data.TransID;

  const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
  const phoneWithoutPlus = phone.replace(/^\+/, '');

  console.log('[MPESA TILL] Parsed:', { amount, phone, tillNumber, reference });

  if (!amount || amount <= 0) {
    throw new Error('Invalid amount');
  }

  if (!phone) {
    throw new Error('Invalid phone number');
  }

  // Find property by Till number
  const propertyResult = await db.query(
    `
    SELECT p.*
    FROM properties p
    INNER JOIN payment_accounts pa ON pa.property_id = p.id
    WHERE pa.account_for = 'rent'
      AND pa.account_type = 'mpesa_till'
      AND pa.till_number = $1
      AND pa.status = 'active'
      AND p.status = 'active'
    `,
    [tillNumber]
  );

  console.log('[MPESA TILL] Property found:', propertyResult.rows[0] ? 'YES' : 'NO');

  if (!propertyResult.rows[0]) {
    await logUnmatchedPayment({
      source: 'mpesa_till',
      amount: amount,
      phone: phone,
      reference: reference,
      till_number: tillNumber,
      raw_data: data,
      ip_address: ipAddress,
    });
    
    return {
      success: false,
      message: 'Property not found for this till number',
      payment: { status: 'unmatched', reason: 'property_not_found' }
    };
  }

  const property = propertyResult.rows[0];

  // Find tenant by phone number
  const tenantResult = await db.query(
    `
    SELECT 
      t.id, 
      t.full_name, 
      t.owner_id, 
      t.property_id, 
      t.unit_id
    FROM tenants t
    WHERE t.status != 'archived'
      AND t.property_id = $1
      AND t.owner_id = $2
      AND (
        t.phone = $3
        OR t.phone = $4
        OR t.phone = $5
      )
    LIMIT 1
    `,
    [property.id, property.owner_id, phone, phoneWithoutPlus, `+${phoneWithoutPlus}`]
  );

  let tenantId = null;
  let tenant = null;

  if (tenantResult.rows[0]) {
    tenant = tenantResult.rows[0];
    tenantId = tenant.id;
  }

  let paymentResult;
  let status = 'unmatched';

  if (tenantId) {
    const allocation = await allocatePaymentFromWebhook({
      tenantId: tenantId,
      amount: amount,
      paymentMethod: 'mpesa_auto',
      reference: reference,
      phone: phone,
      notes: `M-Pesa Till payment from ${phone} - ${reference}`,
      propertyId: property.id,
      ownerId: property.owner_id,
      unitId: tenant.unit_id,
      ipAddress: ipAddress,
    });

    paymentResult = allocation;
    status = 'matched';
  } else {
    const unmatchedResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by
      )
      VALUES ($1, $2, $3, 'mpesa_auto', 'rent_balance', 'mpesa_auto', $4, $5, $6, CURRENT_TIMESTAMP, 'unmatched', NULL)
      RETURNING *
      `,
      [
        property.owner_id,
        property.id,
        amount,
        phone,
        reference,
        `M-Pesa Till payment - no matching tenant found. Till: ${tillNumber}`,
      ]
    );
    paymentResult = unmatchedResult.rows[0];
  }

  await logAudit({
    userId: null,
    action: status === 'matched' ? 'PAYMENT_AUTO_MATCHED' : 'PAYMENT_RECEIVED_UNMATCHED',
    entityType: 'payment',
    entityId: paymentResult.id,
    metadata: {
      source: 'mpesa_till',
      amount: amount,
      phone: phone,
      reference: reference,
      till_number: tillNumber,
      tenant_id: tenantId,
      matched: status === 'matched',
    },
    ipAddress,
  });

  return {
    success: true,
    message: status === 'matched' ? 'Payment processed successfully' : 'Payment received - needs manual matching',
    payment: {
      id: paymentResult.id,
      amount: amount,
      amount_display: formatMoney(amount),
      phone: phone,
      reference: reference,
      status: status,
      tenant_id: tenantId,
      tenant_name: tenant ? tenant.full_name : null,
    },
  };
}

// ============================================================
// BANK WEBHOOK
// ============================================================

async function handleBankWebhook(data, ipAddress) {
  console.log('[BANK WEBHOOK] Received:', data);

  const requiredFields = ['amount', 'account_number', 'reference'];
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const amount = Number(data.amount);
  const accountNumber = data.account_number;
  const reference = data.reference;
  const bankName = data.bank_name || 'Unknown Bank';
  const senderName = data.sender_name || null;

  if (!amount || amount <= 0) {
    throw new Error('Invalid amount');
  }

  // Find the property by payment account (Bank)
  const propertyResult = await db.query(
    `
    SELECT p.*
    FROM properties p
    INNER JOIN payment_accounts pa ON pa.property_id = p.id
    WHERE pa.account_for IN ('rent', 'water')
      AND pa.account_type = 'bank_account'
      AND pa.account_number = $1
      AND pa.status = 'active'
      AND p.status = 'active'
    `,
    [accountNumber]
  );

  if (!propertyResult.rows[0]) {
    await logUnmatchedPayment({
      source: 'bank',
      amount: amount,
      reference: reference,
      account_number: accountNumber,
      bank_name: bankName,
      raw_data: data,
      ip_address: ipAddress,
    });
    
    return {
      success: false,
      message: 'Property not found for this bank account',
      payment: { status: 'unmatched', reason: 'property_not_found' }
    };
  }

  const property = propertyResult.rows[0];

  // Determine if this is rent or water payment
  let applyTo = 'rent_balance';
  const accountInfo = await db.query(
    `
    SELECT account_for
    FROM payment_accounts
    WHERE property_id = $1
      AND account_number = $2
      AND status = 'active'
    `,
    [property.id, accountNumber]
  );

  if (accountInfo.rows[0]?.account_for === 'water') {
    applyTo = 'water_bill';
  }

  // Find tenant by bank reference
  const tenantResult = await db.query(
    `
    SELECT DISTINCT t.id, t.full_name, t.owner_id, t.property_id, t.unit_id
    FROM tenants t
    LEFT JOIN tenant_payment_identities pi ON pi.tenant_id = t.id
    WHERE t.status != 'archived'
      AND t.property_id = $1
      AND t.owner_id = $2
      AND pi.payment_channel = 'bank_reference'
      AND pi.normalized_value = $3
      AND pi.status = 'active'
    LIMIT 1
    `,
    [property.id, property.owner_id, reference]
  );

  let tenantId = null;
  let tenant = null;

  if (tenantResult.rows[0]) {
    tenant = tenantResult.rows[0];
    tenantId = tenant.id;
  }

  let paymentResult;
  let status = 'unmatched';

  if (tenantId) {
    const allocation = await allocatePaymentFromWebhook({
      tenantId: tenantId,
      amount: amount,
      paymentMethod: 'bank_auto',
      reference: reference,
      phone: null,
      notes: `Bank transfer from ${senderName || 'unknown'} - ${bankName}`,
      propertyId: property.id,
      ownerId: property.owner_id,
      unitId: tenant.unit_id,
      applyTo: applyTo,
      ipAddress: ipAddress,
    });

    paymentResult = allocation;
    status = 'matched';
  } else {
    const unmatchedResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by
      )
      VALUES ($1, $2, $3, 'bank_auto', $4, 'bank_auto', $5, $6, $7, CURRENT_TIMESTAMP, 'unmatched', NULL)
      RETURNING *
      `,
      [
        property.owner_id,
        property.id,
        amount,
        applyTo,
        null,
        reference,
        `Bank transfer - no matching tenant found. Account: ${accountNumber}, Bank: ${bankName}`,
      ]
    );
    paymentResult = unmatchedResult.rows[0];
  }

  await logAudit({
    userId: null,
    action: status === 'matched' ? 'PAYMENT_AUTO_MATCHED' : 'PAYMENT_RECEIVED_UNMATCHED',
    entityType: 'payment',
    entityId: paymentResult.id,
    metadata: {
      source: 'bank',
      amount: amount,
      reference: reference,
      account_number: accountNumber,
      bank_name: bankName,
      tenant_id: tenantId,
      matched: status === 'matched',
    },
    ipAddress,
  });

  return {
    success: true,
    message: status === 'matched' ? 'Payment processed successfully' : 'Payment received - needs manual matching',
    payment: {
      id: paymentResult.id,
      amount: amount,
      amount_display: formatMoney(amount),
      reference: reference,
      status: status,
      tenant_id: tenantId,
      tenant_name: tenant ? tenant.full_name : null,
    },
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function allocatePaymentFromWebhook({
  tenantId,
  amount,
  paymentMethod,
  reference,
  phone,
  notes,
  propertyId,
  ownerId,
  unitId,
  applyTo = 'rent_balance',
  ipAddress,
}) {
  // Get tenant's current deposit status
  const tenantResult = await db.query(
    `
    SELECT 
      rent_deposit_amount,
      rent_deposit_paid,
      water_deposit_amount,
      water_deposit_paid
    FROM tenants
    WHERE id = $1
    `,
    [tenantId]
  );

  const tenant = tenantResult.rows[0];
  let remainingAmount = amount;
  let depositApplied = 0;
  let rentApplied = 0;
  let waterBillApplied = 0;

  // For rent payments, check if deposit needs to be paid first
  if (applyTo === 'rent_balance') {
    const depositRequired = Number(tenant.rent_deposit_amount || 0);
    const depositPaid = Number(tenant.rent_deposit_paid || 0);
    const depositRemaining = depositRequired - depositPaid;

    if (depositRemaining > 0) {
      if (remainingAmount >= depositRemaining) {
        depositApplied = depositRemaining;
        remainingAmount -= depositRemaining;
        
        await db.query(
          `
          UPDATE tenants 
          SET rent_deposit_paid = rent_deposit_paid + $1
          WHERE id = $2
          `,
          [depositApplied, tenantId]
        );
      } else {
        depositApplied = remainingAmount;
        remainingAmount = 0;
        
        await db.query(
          `
          UPDATE tenants 
          SET rent_deposit_paid = rent_deposit_paid + $1
          WHERE id = $2
          `,
          [depositApplied, tenantId]
        );
      }
    }
  }

  // For water payments, check if water deposit needs to be paid first
  if (applyTo === 'water_bill') {
    const waterDepositRequired = Number(tenant.water_deposit_amount || 2000);
    const waterDepositPaid = Number(tenant.water_deposit_paid || 0);
    const waterDepositRemaining = waterDepositRequired - waterDepositPaid;

    if (waterDepositRemaining > 0) {
      if (remainingAmount >= waterDepositRemaining) {
        depositApplied = waterDepositRemaining;
        remainingAmount -= waterDepositRemaining;
        
        await db.query(
          `
          UPDATE tenants 
          SET water_deposit_paid = water_deposit_paid + $1
          WHERE id = $2
          `,
          [depositApplied, tenantId]
        );
      } else {
        depositApplied = remainingAmount;
        remainingAmount = 0;
        
        await db.query(
          `
          UPDATE tenants 
          SET water_deposit_paid = water_deposit_paid + $1
          WHERE id = $2
          `,
          [depositApplied, tenantId]
        );
      }
    }
  }

  // Apply remaining to rent or water bill
  if (remainingAmount > 0) {
    if (applyTo === 'water_bill') {
      // Apply to oldest unpaid water bill
      const billResult = await db.query(
        `
        SELECT id, balance
        FROM water_bills
        WHERE tenant_id = $1
          AND status IN ('unpaid', 'partial')
        ORDER BY billing_month ASC
        LIMIT 1
        `,
        [tenantId]
      );

      if (billResult.rows[0]) {
        const bill = billResult.rows[0];
        const billBalance = Number(bill.balance || 0);
        waterBillApplied = Math.min(remainingAmount, billBalance);

        await db.query(
          `
          UPDATE water_bills
          SET 
            amount_paid = amount_paid + $1,
            balance = balance - $1,
            status = CASE 
              WHEN balance - $1 <= 0 THEN 'paid'
              ELSE 'partial'
            END
          WHERE id = $2
          `,
          [waterBillApplied, bill.id]
        );

        remainingAmount -= waterBillApplied;
      }
    } else {
      // Apply to rent balance
      rentApplied = remainingAmount;
      remainingAmount = 0;
    }
  }

  // Create payment records
  const payments = [];

  // Deposit payment (if any)
  if (depositApplied > 0) {
    const depositResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, 'matched', NULL, NULL, CURRENT_TIMESTAMP)
      RETURNING *
      `,
      [
        ownerId,
        propertyId,
        unitId,
        tenantId,
        depositApplied,
        paymentMethod,
        applyTo === 'water_bill' ? 'water_deposit' : 'rent_deposit',
        paymentMethod === 'mpesa_auto' ? 'mpesa_auto' : 'bank_auto',
        phone || null,
        reference ? `${reference}-DEPOSIT` : null,
        notes ? `${notes} (deposit portion)` : 'Deposit payment',
      ]
    );
    payments.push(depositResult.rows[0]);
  }

  // Rent payment (if any)
  if (rentApplied > 0) {
    const rentResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'rent_balance', $7, $8, $9, $10, CURRENT_TIMESTAMP, 'matched', NULL, NULL, CURRENT_TIMESTAMP)
      RETURNING *
      `,
      [
        ownerId,
        propertyId,
        unitId,
        tenantId,
        rentApplied,
        paymentMethod,
        paymentMethod === 'mpesa_auto' ? 'mpesa_auto' : 'bank_auto',
        phone || null,
        reference || null,
        notes || 'Rent payment',
      ]
    );
    payments.push(rentResult.rows[0]);
  }

  // Water bill payment (if any)
  if (waterBillApplied > 0) {
    const waterResult = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'water_bill', $7, $8, $9, $10, CURRENT_TIMESTAMP, 'matched', NULL, NULL, CURRENT_TIMESTAMP)
      RETURNING *
      `,
      [
        ownerId,
        propertyId,
        unitId,
        tenantId,
        waterBillApplied,
        paymentMethod,
        paymentMethod === 'mpesa_auto' ? 'mpesa_auto' : 'bank_auto',
        phone || null,
        reference ? `${reference}-WATER` : null,
        notes ? `${notes} (water bill)` : 'Water bill payment',
      ]
    );
    payments.push(waterResult.rows[0]);
  }

  return payments[0] || null;
}

async function logUnmatchedPayment({
  source,
  amount,
  phone,
  reference,
  business_number,
  account_number,
  till_number,
  bank_name,
  raw_data,
  ip_address,
}) {
  await db.query(
    `
    INSERT INTO audit_logs (
      user_id,
      action,
      entity_type,
      metadata,
      ip_address
    )
    VALUES (
      NULL,
      'UNMATCHED_PAYMENT_RECEIVED',
      'webhook',
      $1,
      $2
    )
    `,
    [
      JSON.stringify({
        source: source,
        amount: amount,
        phone: phone,
        reference: reference,
        business_number: business_number,
        account_number: account_number,
        till_number: till_number,
        bank_name: bank_name,
        raw_data: raw_data,
        timestamp: new Date().toISOString(),
      }),
      ip_address,
    ]
  );

  console.log('[UNMATCHED PAYMENT]', { source, amount, phone, reference });
}

module.exports = {
  handleMpesaPaybillWebhook,
  handleMpesaTillWebhook,
  handleBankWebhook,
  verifyWebhookSignature,
  allocatePaymentFromWebhook,
};