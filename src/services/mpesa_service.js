const db = require('../config/db');
const daraja = require('../utils/daraja');
const { decryptJson } = require('../utils/crypto');
const { normalizePhone } = require('../utils/phone');
const { logAudit } = require('./audit_service');

function getOwnerId(user) {
  return user.role === 'admin' ? null : user.id;
}

function normalizeReference(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function parseDarajaTime(value) {
  const raw = String(value || '');

  if (!/^\d{14}$/.test(raw)) {
    return new Date();
  }

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));

  return new Date(year, month, day, hour, minute, second);
}

async function getAccountWithCredentials(user, paymentAccountId) {
  const ownerId = getOwnerId(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          pa.*,
          p.name AS property_name,
          p.owner_id,
          credentials.encrypted_credentials,
          credentials.environment
        FROM payment_accounts pa
        INNER JOIN properties p ON p.id = pa.property_id
        LEFT JOIN payment_provider_credentials credentials
          ON credentials.payment_account_id = pa.id
        WHERE pa.id = $1
          AND pa.owner_id = $2
          AND pa.status = 'active'
        LIMIT 1
        `,
        [paymentAccountId, ownerId]
      )
    : await db.query(
        `
        SELECT
          pa.*,
          p.name AS property_name,
          p.owner_id,
          credentials.encrypted_credentials,
          credentials.environment
        FROM payment_accounts pa
        INNER JOIN properties p ON p.id = pa.property_id
        LEFT JOIN payment_provider_credentials credentials
          ON credentials.payment_account_id = pa.id
        WHERE pa.id = $1
          AND pa.status = 'active'
        LIMIT 1
        `,
        [paymentAccountId]
      );

  if (!result.rows[0]) {
    throw new Error('Payment account not found');
  }

  const account = result.rows[0];

  if (!account.encrypted_credentials) {
    throw new Error('This payment account has no saved provider credentials');
  }

  return {
    ...account,
    credentials: decryptJson(account.encrypted_credentials),
  };
}

async function connectMpesaAccount(user, paymentAccountId, ipAddress) {
  const account = await getAccountWithCredentials(user, paymentAccountId);

  if (account.account_type !== 'mpesa_paybill') {
    throw new Error(
      'Automatic M-Pesa C2B setup currently supports PayBill accounts only'
    );
  }

  const callbackBaseUrl = process.env.PAYMENT_CALLBACK_BASE_URL;

  if (!callbackBaseUrl || callbackBaseUrl.includes('localhost')) {
    throw new Error(
      'PAYMENT_CALLBACK_BASE_URL must be a public HTTPS Render URL before connecting M-Pesa'
    );
  }

  const confirmationUrl = `${callbackBaseUrl}/api/payments/mpesa/c2b/confirmation`;
  const validationUrl = `${callbackBaseUrl}/api/payments/mpesa/c2b/validation`;

  await db.query(
    `
    UPDATE payment_accounts
    SET connection_status = 'connecting',
        connection_error = NULL,
        last_connection_test_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [paymentAccountId]
  );

  try {
    await daraja.registerC2BUrls({
      consumerKey: account.credentials.consumer_key,
      consumerSecret: account.credentials.consumer_secret,
      shortCode: account.business_number,
      validationUrl,
      confirmationUrl,
      environment: account.environment || process.env.MPESA_ENV || 'sandbox',
    });

    const result = await db.query(
      `
      UPDATE payment_accounts
      SET connection_status = 'connected',
          connected_at = CURRENT_TIMESTAMP,
          callback_registered_at = CURRENT_TIMESTAMP,
          connection_error = NULL
      WHERE id = $1
      RETURNING *
      `,
      [paymentAccountId]
    );

    await logAudit({
      userId: user.id,
      action: 'MPESA_ACCOUNT_CONNECTED',
      entityType: 'payment_account',
      entityId: paymentAccountId,
      metadata: {
        property_id: account.property_id,
        account_for: account.account_for,
        business_number: account.business_number,
      },
      ipAddress,
    });

    return result.rows[0];
  } catch (error) {
    await db.query(
      `
      UPDATE payment_accounts
      SET connection_status = 'failed',
          connection_error = $2,
          last_connection_test_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [paymentAccountId, error.message]
    );

    throw new Error(
      `Could not connect M-Pesa account: ${error.response?.data?.errorMessage || error.message}`
    );
  }
}

async function simulateMpesaPayment(user, data, ipAddress) {
  const account = await getAccountWithCredentials(
    user,
    Number(data.payment_account_id)
  );

  if (account.account_type !== 'mpesa_paybill') {
    throw new Error('Sandbox simulation currently supports M-Pesa PayBill only');
  }

  if (!data.phone || !data.amount) {
    throw new Error('phone and amount are required');
  }

  const result = await daraja.simulateC2BPayment({
    consumerKey: account.credentials.consumer_key,
    consumerSecret: account.credentials.consumer_secret,
    shortCode: account.business_number,
    phoneNumber: data.phone,
    amount: data.amount,
    billRefNumber: data.bill_ref_number || 'TEST',
    environment: account.environment || process.env.MPESA_ENV || 'sandbox',
  });

  await logAudit({
    userId: user.id,
    action: 'MPESA_SANDBOX_PAYMENT_SIMULATED',
    entityType: 'payment_account',
    entityId: account.id,
    metadata: {
      property_id: account.property_id,
      amount: Number(data.amount),
      phone: normalizePhone(data.phone),
      bill_ref_number: data.bill_ref_number || 'TEST',
    },
    ipAddress,
  });

  return result;
}

async function validateC2BPayment(payload, ipAddress) {
  await logAudit({
    userId: null,
    action: 'MPESA_C2B_VALIDATION_RECEIVED',
    entityType: 'payment',
    metadata: {
      transaction_id: payload.TransID || null,
      shortcode: payload.BusinessShortCode || null,
      bill_ref_number: payload.BillRefNumber || null,
    },
    ipAddress,
  });
}

async function findPaymentAccount(shortCode) {
  const result = await db.query(
    `
    SELECT pa.*
    FROM payment_accounts pa
    INNER JOIN properties p ON p.id = pa.property_id
    WHERE p.status = 'active'
      AND pa.status = 'active'
      AND pa.account_type = 'mpesa_paybill'
      AND pa.business_number = $1
    LIMIT 1
    `,
    [String(shortCode)]
  );

  return result.rows[0] || null;
}

async function findTenant(account, phone, billReference) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedReference = normalizeReference(billReference);

  const referenceMatch = await db.query(
    `
    SELECT t.*
    FROM tenant_payment_identities identity
    INNER JOIN tenants t ON t.id = identity.tenant_id
    WHERE identity.owner_id = $1
      AND identity.account_for = $2
      AND identity.payment_channel = 'bank_reference'
      AND identity.normalized_value = $3
      AND identity.status = 'active'
      AND t.status = 'active'
    LIMIT 1
    `,
    [account.owner_id, account.account_for, normalizedReference]
  );

  if (referenceMatch.rows[0]) {
    return referenceMatch.rows[0];
  }

  const phoneMatch = await db.query(
    `
    SELECT t.*
    FROM tenant_payment_identities identity
    INNER JOIN tenants t ON t.id = identity.tenant_id
    WHERE identity.owner_id = $1
      AND identity.account_for = $2
      AND identity.payment_channel = 'mpesa_phone'
      AND identity.normalized_value = $3
      AND identity.status = 'active'
      AND t.status = 'active'
    LIMIT 1
    `,
    [account.owner_id, account.account_for, normalizedPhone]
  );

  return phoneMatch.rows[0] || null;
}

async function processC2BConfirmation(payload, ipAddress) {
  const transactionId = payload.TransID;

  if (!transactionId || !payload.TransAmount || !payload.BusinessShortCode) {
    throw new Error('M-Pesa callback is missing required payment details');
  }

  const alreadyProcessed = await db.query(
    `
    SELECT id
    FROM payments
    WHERE provider_code = 'mpesa'
      AND provider_transaction_id = $1
    LIMIT 1
    `,
    [transactionId]
  );

  if (alreadyProcessed.rows[0]) {
    return { duplicate: true, payment_id: Number(alreadyProcessed.rows[0].id) };
  }

  const account = await findPaymentAccount(payload.BusinessShortCode);

  if (!account) {
    throw new Error('No active Kodi M-Pesa PayBill account matches this shortcode');
  }

  const tenant = await findTenant(
    account,
    payload.MSISDN,
    payload.BillRefNumber
  );

  const applyTo = account.account_for === 'water'
    ? 'water_bill'
    : 'rent_balance';

  const result = await db.query(
    `
    INSERT INTO payments (
      owner_id,
      property_id,
      unit_id,
      tenant_id,
      payment_account_id,
      amount,
      payment_method,
      apply_to,
      payment_source,
      provider_code,
      provider_transaction_id,
      business_number,
      bill_ref_number,
      provider_payload,
      phone,
      reference,
      received_at,
      status,
      matched_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, 'mpesa_auto', $7, 'mpesa_auto',
      'mpesa', $8, $9, $10, $11, $12, $13, $14, $15
    )
    RETURNING *
    `,
    [
      account.owner_id,
      account.property_id,
      tenant?.unit_id || null,
      tenant?.id || null,
      account.id,
      Number(payload.TransAmount),
      applyTo,
      transactionId,
      String(payload.BusinessShortCode),
      payload.BillRefNumber || null,
      payload,
      normalizePhone(payload.MSISDN),
      transactionId,
      parseDarajaTime(payload.TransTime),
      tenant ? 'matched' : 'unmatched',
      tenant ? new Date() : null,
    ]
  );

  const payment = result.rows[0];

  await logAudit({
    userId: null,
    action: tenant ? 'MPESA_PAYMENT_AUTO_MATCHED' : 'MPESA_PAYMENT_UNMATCHED',
    entityType: 'payment',
    entityId: payment.id,
    metadata: {
      transaction_id: transactionId,
      amount: Number(payload.TransAmount),
      tenant_id: tenant?.id || null,
      property_id: account.property_id,
      account_for: account.account_for,
    },
    ipAddress,
  });

  return {
    duplicate: false,
    payment,
  };
}

module.exports = {
  connectMpesaAccount,
  simulateMpesaPayment,
  validateC2BPayment,
  processC2BConfirmation,
};