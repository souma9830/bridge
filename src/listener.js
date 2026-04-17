const StellarSdk = require('stellar-sdk');
const Cursor = require('../db/Cursor');
const { transformPayload } = require('./transformer');
const { dispatchWebhook } = require('./dispatcher');
const logger = require('../utils/logger').child('Listener');
const metrics = require('../utils/metrics');

const server = new StellarSdk.Horizon.Server(
  process.env.STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
);

// Map of address -> stream close function
const streams = new Map();

/**
 * Initializes and starts listeners for the given watch configurations.
 * Groups watches by their Stellar address to avoid multiple streams per address.
 *
 * @param {Array} watches - The array of watch configurations from config.json
 */
async function startListeners(watches) {
  // Group watches by address
  const watchesByAddress = {};
  for (const watch of watches) {
    if (!watchesByAddress[watch.address]) {
      watchesByAddress[watch.address] = [];
    }
    watchesByAddress[watch.address].push(watch);
  }

  // Start a stream for each unique address
  for (const [address, accountWatches] of Object.entries(watchesByAddress)) {
    const streamIdentifier = `account_operations_${address}`;
    await startStreamForAddress(address, streamIdentifier, accountWatches);
  }

  logger.info(`Started ${streams.size} stream(s) for ${watches.length} watch(es)`);
}

/**
 * Starts an operation stream for a specific address with rate limit handling.
 */
async function startStreamForAddress(address, streamIdentifier, watches, backoffDelay = 1000) {
  try {
    // 1. Fetch the last processed cursor for this specific stream
    const cursorObj = await Cursor.findOne({ streamIdentifier });
    const pagingToken = cursorObj ? cursorObj.pagingToken : 'now';

    const shortAddr = `${address.substring(0, 8)}…${address.substring(address.length - 6)}`;
    logger.info(`Starting operations stream for ${shortAddr} from cursor: ${pagingToken}`);

    // 2. Setup the stream builder — use operations() instead of payments()
    const builder = server.operations().forAccount(address).cursor(pagingToken);

    // 3. Aggregate allowed operation types from all watches for this address
    const allowedTypes = new Set();
    for (const w of watches) {
      if (w.operationTypes) {
        w.operationTypes.forEach((t) => allowedTypes.add(t));
      }
    }

    // 4. Initiate the stream
    const closeStream = builder.stream({
      onmessage: async (operation) => {
        try {
          // Reset backoff delay on successful message
          backoffDelay = 1000;

          metrics.inc('operationsReceived');

          // Pre-filter by operation type if any watches define types
          if (allowedTypes.size > 0 && !allowedTypes.has(operation.type)) {
            return; // Skip this operation type entirely
          }

          await handleOperation(operation, watches);

          // Update cursor in database after successful processing
          await Cursor.findOneAndUpdate(
            { streamIdentifier },
            { pagingToken: operation.paging_token, updatedAt: new Date() },
            { upsert: true, new: true }
          );
        } catch (error) {
          logger.error(`Error processing operation for ${shortAddr}: ${error.message}`);
        }
      },
      onerror: (error) => {
        logger.error(`Stream connection error for ${shortAddr}: ${error?.message || error}`);

        // Handle Horizon 429 Too Many Requests
        const isRateLimit = error?.response?.status === 429;
        const currentBackoff = isRateLimit ? Math.max(backoffDelay, 5000) : backoffDelay;

        logger.warn(`Reconnecting ${shortAddr} in ${currentBackoff}ms...`);

        // Close current broken stream
        if (streams.has(address)) {
          streams.get(address)();
          streams.delete(address);
        }

        // Exponential backoff
        setTimeout(() => {
          const nextBackoff = Math.min(currentBackoff * 2, 60000); // Max 60 seconds
          startStreamForAddress(address, streamIdentifier, watches, nextBackoff);
        }, currentBackoff);
      },
    });

    streams.set(address, closeStream);
  } catch (err) {
    logger.error(`Stream setup failed for ${address}: ${err.message}`);
    setTimeout(() => {
      startStreamForAddress(address, streamIdentifier, watches, backoffDelay * 2);
    }, backoffDelay);
  }
}

/**
 * Validates the operation against each watch's rules and dispatches if matched.
 */
async function handleOperation(operation, watches) {
  const payload = transformPayload(operation);

  for (const watch of watches) {
    // Check operation type filter
    if (watch.operationTypes && !watch.operationTypes.includes(payload.type)) {
      continue;
    }

    // Check asset and amount filters (only relevant for payment-like ops)
    const isMatchedAsset = checkAssetMatch(payload, watch);
    const isMatchedAmount = checkAmountMatch(payload, watch);

    if (isMatchedAsset && isMatchedAmount) {
      metrics.inc('operationsMatched');
      metrics.incWatch(watch.id, 'matched');

      logger.info(`Match: ${watch.id} ← operation ${payload.id} (${payload.type})`);
      await dispatchWebhook(payload, watch);
    }
  }
}

function checkAssetMatch(payload, watch) {
  if (!watch.assetCode) return true; // No asset filter defined
  return payload.asset_code === watch.assetCode;
}

function checkAmountMatch(payload, watch) {
  if (!watch.minAmount) return true; // No amount filter defined
  if (!payload.amount) return false;

  return parseFloat(payload.amount) >= parseFloat(watch.minAmount);
}

/**
 * Stops all active Horizon streams.
 */
function stopAllStreams() {
  logger.info(`Stopping ${streams.size} active stream(s)...`);
  for (const [address, close] of streams) {
    try {
      close();
      logger.debug(`Closed stream for ${address}`);
    } catch (err) {
      logger.error(`Error closing stream for ${address}: ${err.message}`);
    }
  }
  streams.clear();
  logger.info('All streams stopped');
}

/**
 * Returns the active streams map (for dashboard/API).
 */
function getActiveStreams() {
  return streams;
}

module.exports = { startListeners, stopAllStreams, getActiveStreams };
