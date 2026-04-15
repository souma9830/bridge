const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const crypto = require('crypto');
const logger = require('../utils/logger').child('Dispatcher');
const metrics = require('../utils/metrics');
const { enqueueDeadLetter } = require('./dlqProcessor');

// Configure axios to retry on failure (network errors, 5xx responses)
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500;
  },
  onRetry: (retryCount, error) => {
    logger.warn(`Webhook dispatch retry #${retryCount}: ${error.message}`);
  },
});

/**
 * Dispatches the transformed payload to the configured webhook URL.
 * Computes an HMAC-SHA256 signature and attaches it as a header.
 *
 * @param {Object} payload - The transformed JSON payload
 * @param {Object} watchConfig - The specific watch configuration object
 * @param {boolean} skipDLQ - If true, don't enqueue to DLQ on failure (used by DLQ processor itself)
 */
async function dispatchWebhook(payload, watchConfig, skipDLQ = false) {
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
        'X-Stellar-Signature': signature,
        'X-Stellar-Timestamp': new Date().toISOString(),
      },
      timeout: 10000, // 10s timeout
    });

    metrics.inc('webhooksDispatched');
    if (watchConfig.id) {
      metrics.incWatch(watchConfig.id, 'dispatched');
    }

    logger.info(`Dispatched ${payload.id} → ${webhookUrl} (${response.status})`);
  } catch (error) {
    metrics.inc('webhooksFailed');
    if (watchConfig.id) {
      metrics.incWatch(watchConfig.id, 'failed');
    }

    logger.error(`Failed to dispatch ${payload.id} → ${webhookUrl}: ${error.message}`);

    if (!skipDLQ) {
      await enqueueDeadLetter(payload, watchConfig, error.message);
    } else {
      // Re-throw so callers (like DLQ processor) can handle the failure
      throw error;
    }
  }
}

module.exports = { dispatchWebhook };
