const africastalking = require('africastalking');

const SMS_COST_PER_MESSAGE = 1.50;

const SMS_MODE = process.env.SMS_MODE || 'live';

const sms_client =
  SMS_MODE === 'console'
    ? null
    : africastalking({
        apiKey: process.env.AFRICASTALKING_API_KEY,
        username: process.env.AFRICASTALKING_USERNAME,
      }).SMS;

function success_response(message_id, recipient = null) {
  return {
    success: true,
    status: 'sent',
    message_id,
    cost: SMS_COST_PER_MESSAGE,
    recipient,
    error: null,
  };
}

function failed_response(error) {
  return {
    success: false,
    status: 'failed',
    message_id: null,
    cost: 0,
    recipient: null,
    error,
  };
}

async function send_sms({ phone, message, sender_id }) {
  if (SMS_MODE === 'console') {
    console.log(`[SMS] ${phone}`);
    console.log(message);

    return success_response(`console-${Date.now()}`);
  }

  try {
    const payload = {
      to: [phone],
      message,
    };

    if (sender_id || process.env.AFRICASTALKING_SENDER_ID) {
      payload.from = sender_id || process.env.AFRICASTALKING_SENDER_ID;
    }

    const response = await sms_client.send(payload);

    const sms_data = response?.SMSMessageData;

    if (!sms_data) {
      return failed_response('Invalid response from provider');
    }

    const recipient = sms_data.Recipients?.[0];

    if (sms_data.Message === 'Sent' || sms_data.Message === 'Queued') {
      return success_response(
        recipient?.messageId || `at-${Date.now()}`,
        recipient
      );
    }

    return failed_response(sms_data.Message || 'Unknown error');
  } catch (error) {
    console.error('SMS sending failed:', error.message);
    return failed_response(error.message);
  }
}

async function send_bulk_sms(recipients, sender_id) {
  const results = [];
  const chunk_size = 100;

  for (let i = 0; i < recipients.length; i += chunk_size) {
    const chunk = recipients.slice(i, i + chunk_size);

    if (SMS_MODE === 'console') {
      for (const recipient of chunk) {
        console.log(`[SMS] ${recipient.phone}`);
        console.log(recipient.message);

        results.push({
          phone: recipient.phone,
          ...success_response(`console-${Date.now()}`),
        });
      }

      continue;
    }

    try {
      const payload = {
        to: chunk.map((recipient) => recipient.phone),
        message: chunk[0].message,
      };

      if (sender_id || process.env.AFRICASTALKING_SENDER_ID) {
        payload.from = sender_id || process.env.AFRICASTALKING_SENDER_ID;
      }

      const response = await sms_client.send(payload);

      const sms_data = response?.SMSMessageData;

      if (!sms_data) {
        for (const recipient of chunk) {
          results.push({
            phone: recipient.phone,
            ...failed_response('Invalid response from provider'),
          });
        }

        continue;
      }

      const provider_recipients = sms_data.Recipients || [];

      for (let j = 0; j < chunk.length; j++) {
        const provider_recipient = provider_recipients[j];

        if (sms_data.Message === 'Sent' || sms_data.Message === 'Queued') {
          results.push({
            phone: chunk[j].phone,
            ...success_response(
              provider_recipient?.messageId || `at-${Date.now()}-${j}`,
              provider_recipient
            ),
          });
        } else {
          results.push({
            phone: chunk[j].phone,
            ...failed_response(sms_data.Message || 'Unknown error'),
          });
        }
      }
    } catch (error) {
      console.error('Bulk SMS sending failed:', error.message);

      for (const recipient of chunk) {
        results.push({
          phone: recipient.phone,
          ...failed_response(error.message),
        });
      }
    }
  }

  return results;
}

async function check_balance() {
  if (SMS_MODE === 'console') {
    return {
      balance: 'KES 1000.00',
      currency: 'KES',
    };
  }

  try {
    const response = await fetch('https://api.africastalking.com/version1/user', {
      method: 'GET',
      headers: {
        apiKey: process.env.AFRICASTALKING_API_KEY,
        Accept: 'application/json',
      },
    });

    const data = await response.json();

    if (data?.UserData) {
      return {
        balance: data.UserData.balance,
        currency: data.UserData.currencyCode || 'KES',
      };
    }

    return {
      balance: 'Unknown',
      currency: 'KES',
    };
  } catch (error) {
    console.error('Balance check failed:', error.message);

    return {
      balance: 'Unknown',
      currency: 'KES',
      error: error.message,
    };
  }
}

module.exports = {
  send_sms,
  send_bulk_sms,
  check_balance,
  SMS_COST_PER_MESSAGE,
};