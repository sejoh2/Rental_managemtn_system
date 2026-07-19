const axios = require('axios');

function getBaseUrl(environment = 'sandbox') {
  return environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function normalizeMsisdn(phone) {
  let value = String(phone || '').replace(/\s+/g, '');

  if (value.startsWith('+')) value = value.slice(1);
  if (value.startsWith('0')) value = `254${value.slice(1)}`;
  if (!value.startsWith('254')) value = `254${value}`;

  return value;
}

async function getAccessToken({
  consumerKey,
  consumerSecret,
  environment = 'sandbox',
}) {
  if (!consumerKey || !consumerSecret) {
    throw new Error('M-Pesa Consumer Key and Consumer Secret are required');
  }

  const authorization = Buffer.from(
    `${consumerKey}:${consumerSecret}`
  ).toString('base64');

  const response = await axios.get(
    `${getBaseUrl(environment)}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${authorization}`,
      },
    }
  );

  return response.data.access_token;
}

async function registerC2BUrls({
  consumerKey,
  consumerSecret,
  shortCode,
  validationUrl,
  confirmationUrl,
  environment = 'sandbox',
}) {
  const token = await getAccessToken({
    consumerKey,
    consumerSecret,
    environment,
  });

  const response = await axios.post(
    `${getBaseUrl(environment)}/mpesa/c2b/v1/registerurl`,
    {
      ShortCode: String(shortCode),
      ResponseType: 'Completed',
      ValidationURL: validationUrl,
      ConfirmationURL: confirmationUrl,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

async function simulateC2BPayment({
  consumerKey,
  consumerSecret,
  shortCode,
  phoneNumber,
  amount,
  billRefNumber,
  environment = 'sandbox',
}) {
  if (environment !== 'sandbox') {
    throw new Error('Simulation is available only in the M-Pesa sandbox');
  }

  const token = await getAccessToken({
    consumerKey,
    consumerSecret,
    environment,
  });

  const response = await axios.post(
    `${getBaseUrl(environment)}/mpesa/c2b/v1/simulate`,
    {
      ShortCode: String(shortCode),
      CommandID: 'CustomerPayBillOnline',
      Amount: Number(amount),
      Msisdn: normalizeMsisdn(phoneNumber),
      BillRefNumber: billRefNumber || 'TEST',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

module.exports = {
  getAccessToken,
  registerC2BUrls,
  simulateC2BPayment,
};