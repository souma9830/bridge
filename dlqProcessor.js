const DeadLetter = require('../db/DeadLetter');
const { dispatchWebhook } = require('./dispatcher');
const logger = require('../utils/logger').child('DLQ');
const metrics = require('../utils/metrics');

let intervalHandle = null;

/**
 * Processes pending dead-letter entries.
 * Retries dispatch with exponential backoff.
 */
async function processDLQ() {
  try {
    const entries = await DeadLetter.find({
      status: 'pending',
      nextRetryAt: { $lte: new Date() },
    }).limit(10).sort({ nextRetryAt: 1 });

    for (const entry of entries) {
      entry.attempts += 1;
      logger.info(`Retrying DLQ entry ${entry._id} (attempt ${entry.attempts}/${entry.maxAttempts})`, {
        watchId: entry.watchId,
      });

      try {
        await dispatchWebhook(entry.payload, {
          webhookUrl: entry.webhookUrl,
          hmacSecret: entry.hmacSecret,
        }, true /* skipDLQ — avoid infinite loop */);

        // Success: remove from DLQ
        await DeadLetter.deleteOne({ _id: entry._id });
        metrics.inc('dlqPending', -1);
        logger.info(`DLQ entry ${entry._id} dispatched successfully — removed from queue`);
      } catch (err) {
        if (entry.attempts >= entry.maxAttempts) {
          entry.status = 'exhausted';
          metrics.inc('dlqPending', -1);
          metrics.inc('dlqExhausted');
          logger.error(`DLQ entry ${entry._id} exhausted after ${entry.maxAttempts} attempts`, {
            watchId: entry.watchId,
            error: err.message,
          });
        } else {
          // Exponential backoff: 30s, 60s, 120s, 240s
          const delayMs = 30000 * Math.pow(2, entry.attempts - 1);
          entry.nextRetryAt = new Date(Date.now() + delayMs);
          entry.error = err.message;
          logger.warn(`DLQ retry failed for ${entry._id}, next retry in ${delayMs / 1000}s`);
        }
        await entry.save();
      }
    }
  } catch (err) {
    logger.error(`DLQ processor error: ${err.message}`);
  }
}

/**
 * Enqueue a failed webhook payload into the Dead Letter Queue.
 */
async function enqueueDeadLetter(payload, watchConfig, errorMessage) {
  try {
    await DeadLetter.create({
      watchId: watchConfig.id || 'unknown',
      payload,
      webhookUrl: watchConfig.webhookUrl,
      hmacSecret: watchConfig.hmacSecret,
      error: errorMessage,
      attempts: 0,
      nextRetryAt: new Date(Date.now() + 30000), // first retry in 30s
    });
    metrics.inc('dlqPending');
    logger.info(`Enqueued dead letter for watch "${watchConfig.id}"`);
  } catch (err) {
    logger.error(`Failed to enqueue dead letter: ${err.message}`);
  }
}

/**
 * Start the DLQ processor loop.
 */
function startDLQProcessor(intervalMs = 30000) {
  logger.info(`DLQ processor started (polling every ${intervalMs / 1000}s)`);
  processDLQ(); // initial run
  intervalHandle = setInterval(processDLQ, intervalMs);
}

function stopDLQProcessor() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('DLQ processor stopped');
  }
}

/**
 * Get DLQ summary stats.
 */
async function getDLQStats() {
  const pending = await DeadLetter.countDocuments({ status: 'pending' });
  const exhausted = await DeadLetter.countDocuments({ status: 'exhausted' });
  return { pending, exhausted };
}

module.exports = { startDLQProcessor, stopDLQProcessor, enqueueDeadLetter, processDLQ, getDLQStats };
