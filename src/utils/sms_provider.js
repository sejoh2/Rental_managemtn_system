const africastalking = require('africastalking');

// Initialize Africa's Talking client
const client = africastalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME,
});

const SMS_COST_PER_MESSAGE = 1.50; // KES per SMS

/**
 * Send SMS via Africa's Talking
 * @param {Object} options - SMS options
 * @param {string} options.phone - Recipient phone number
 * @param {string} options.message - SMS message
 * @param {string} options.senderId - Optional sender ID (overrides env)
 * @returns {Promise<Object>} - Result with status, messageId, cost
 */
async function sendSms({ phone, message, senderId }) {
  // If in console mode, just log
  if (process.env.SMS_MODE === 'console') {
    console.log(`[SMS] To: ${phone}, Message: ${message}`);
    return {
      status: 'sent',
      messageId: `console-${Date.now()}`,
      cost: SMS_COST_PER_MESSAGE,
      success: true,
    };
  }

  try {
    const sms = client.SMS;
    const options = {
      to: [phone],
      message: message,
    };

    // Use custom sender ID or default
    if (senderId || process.env.AFRICASTALKING_SENDER_ID) {
      options.from = senderId || process.env.AFRICASTALKING_SENDER_ID;
    }

    const response = await sms.send(options);

    // Check if the message was sent successfully
    if (response && response.SMSMessageData) {
      const data = response.SMSMessageData;
      const recipient = data.Recipients && data.Recipients[0];

      if (data.Message === 'Sent' || data.Message === 'Queued') {
        return {
          status: 'sent',
          messageId: recipient?.messageId || `at-${Date.now()}`,
          cost: SMS_COST_PER_MESSAGE,
          success: true,
          recipient: recipient,
        };
      } else {
        return {
          status: 'failed',
          messageId: null,
          cost: 0,
          success: false,
          error: data.Message || 'Unknown error',
        };
      }
    } else {
      return {
        status: 'failed',
        messageId: null,
        cost: 0,
        success: false,
        error: 'Invalid response from provider',
      };
    }
  } catch (error) {
    console.error('SMS sending failed:', error.message);
    return {
      status: 'failed',
      messageId: null,
      cost: 0,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send bulk SMS to multiple recipients
 * @param {Array} recipients - Array of {phone, message} objects
 * @param {string} senderId - Optional sender ID
 * @returns {Promise<Array>} - Results for each message
 */
async function sendBulkSms(recipients, senderId) {
  const results = [];

  // Africa's Talking supports up to 100 recipients per request
  const chunkSize = 100;

  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);

    // For console mode
    if (process.env.SMS_MODE === 'console') {
      for (const recipient of chunk) {
        console.log(`[SMS] To: ${recipient.phone}, Message: ${recipient.message}`);
        results.push({
          phone: recipient.phone,
          status: 'sent',
          messageId: `console-${Date.now()}`,
          cost: SMS_COST_PER_MESSAGE,
          success: true,
        });
      }
      continue;
    }

    try {
      // Africa's Talking bulk send
      const sms = client.SMS;
      const options = {
        to: chunk.map(r => r.phone),
        message: chunk[0].message, // Same message for all in bulk
      };

      if (senderId || process.env.AFRICASTALKING_SENDER_ID) {
        options.from = senderId || process.env.AFRICASTALKING_SENDER_ID;
      }

      const response = await sms.send(options);

      if (response && response.SMSMessageData) {
        const data = response.SMSMessageData;
        const recipientsList = data.Recipients || [];

        for (let j = 0; j < chunk.length; j++) {
          const recipient = recipientsList[j] || {};
          results.push({
            phone: chunk[j].phone,
            status: data.Message === 'Sent' || data.Message === 'Queued' ? 'sent' : 'failed',
            messageId: recipient.messageId || `at-${Date.now()}-${j}`,
            cost: SMS_COST_PER_MESSAGE,
            success: data.Message === 'Sent' || data.Message === 'Queued',
            error: data.Message !== 'Sent' && data.Message !== 'Queued' ? data.Message : null,
          });
        }
      } else {
        // Fallback: mark all as failed
        for (const recipient of chunk) {
          results.push({
            phone: recipient.phone,
            status: 'failed',
            messageId: null,
            cost: 0,
            success: false,
            error: 'Invalid response from provider',
          });
        }
      }
    } catch (error) {
      console.error('Bulk SMS sending failed:', error.message);
      for (const recipient of chunk) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          messageId: null,
          cost: 0,
          success: false,
          error: error.message,
        });
      }
    }
  }

  return results;
}

/**
 * Check SMS balance
 * @returns {Promise<Object>} - Balance information
 */
async function checkBalance() {
  if (process.env.SMS_MODE === 'console') {
    return {
      balance: 'KES 1000.00',
      currency: 'KES',
    };
  }

  try {
    const response = await fetch('https://api.africastalking.com/version1/user', {
      method: 'GET',
      headers: {
        'apiKey': process.env.AFRICASTALKING_API_KEY,
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (data && data.UserData) {
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
  sendSms,
  sendBulkSms,
  checkBalance,
  SMS_COST_PER_MESSAGE,
};