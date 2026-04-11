const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const crypto = require('crypto');

// Configure axios to retry on failure (network errors, 5xx responses)
axiosRetry(axios, {
  retries: 3, 
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500;
  }
});

/**
 * Dispatches the transformed payload to the configured webhook URL.
 * It computes an HMAC signature and adds it to the headers.
 * 
 * @param {Object} payload - The transformed JSON payload
 * @param {Object} watchConfig - The specific watch configuration object
 */
async function dispatchWebhook(payload, watchConfig) {
  const { webhookUrl, hmacSecret } = watchConfig;
  
  const payloadString = JSON.stringify(payload);
  
  // Create HMAC signature
  const signature = crypto
    .createHmac('sha256', hmacSecret)
    .update(payloadString)
    .digest('hex');
    
  try {
    const response = await axios.post(webhookUrl, payloadString, {
      headers: {
        'Content-Type': 'application/json',
        'X-Stellar-Signature': signature
      }
    });
    
    console.log(`[Webhook] Dispatched ${payload.id} to ${webhookUrl} (Status: ${response.status})`);
  } catch (error) {
    console.error(`[Webhook Error] Failed to dispatch ${payload.id} to ${webhookUrl}: ${error.message}`);
    // You could throw the error here to trigger an outer stream retry, or just log it 
    // depending on your reliability needs.
    throw error;
  }
}

module.exports = { dispatchWebhook };
