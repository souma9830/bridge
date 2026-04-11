const StellarSdk = require('stellar-sdk');
const Cursor = require('../db/Cursor');
const { transformPayload } = require('./transformer');
const { dispatchWebhook } = require('./dispatcher');

const server = new StellarSdk.Horizon.Server(
  process.env.STELLAR_NETWORK === 'TESTNET' 
    ? 'https://horizon-testnet.stellar.org' 
    : 'https://horizon.stellar.org'
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
    const streamIdentifier = `account_payments_${address}`;
    await startStreamForAddress(address, streamIdentifier, accountWatches);
  }
}

/**
 * Starts a stream for a specific address with rate limit handling.
 */
async function startStreamForAddress(address, streamIdentifier, watches, backoffDelay = 1000) {
  try {
    // 1. Fetch the last processed cursor for this specific stream
    let cursorObj = await Cursor.findOne({ streamIdentifier });
    let pagingToken = cursorObj ? cursorObj.pagingToken : 'now';

    console.log(`[Stream] Starting listener for ${address} from cursor: ${pagingToken}`);

    // 2. Setup the stream builder
    const builder = server.payments().forAccount(address).cursor(pagingToken);

    // 3. Initiate the stream
    const closeStream = builder.stream({
      onmessage: async (operation) => {
        try {
          // Reset backoff delay on successful message
          backoffDelay = 1000;
          
          await handleOperation(operation, watches);

          // Update cursor in database after successful processing
          await Cursor.findOneAndUpdate(
            { streamIdentifier },
            { pagingToken: operation.paging_token, updatedAt: new Date() },
            { upsert: true, new: true }
          );
        } catch (error) {
          console.error(`[Stream] Error processing message for ${address}:`, error);
          // If we fail processing (e.g. webhook is definitively down),
          // we should probably stop the stream and retry later to avoid missing data.
          // For now, we log the error. In production, consider dead-letter queues.
        }
      },
      onerror: (error) => {
        console.error(`[Stream] Connection error for ${address}:`, error.message || error);
        
        // Handle Horizon 429 Too Many Requests
        const isRateLimit = error?.response?.status === 429;
        const currentBackoff = isRateLimit ? Math.max(backoffDelay, 5000) : backoffDelay;
        
        console.log(`[Stream] Reconnecting ${address} in ${currentBackoff}ms...`);
        
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
      }
    });

    streams.set(address, closeStream);
  } catch (err) {
    console.error(`[Stream] Setup failed for ${address}:`, err);
    setTimeout(() => {
      startStreamForAddress(address, streamIdentifier, watches, backoffDelay * 2);
    }, backoffDelay);
  }
}

/**
 * Validates the operation against the watch rules and dispatches if matched.
 */
async function handleOperation(operation, watches) {
  const payload = transformPayload(operation);

  for (const watch of watches) {
    // Basic filter logic based on the config
    const isMatchedAsset = checkAssetMatch(payload, watch);
    const isMatchedAmount = checkAmountMatch(payload, watch);

    if (isMatchedAsset && isMatchedAmount) {
      console.log(`[Stream] Match found for ${watch.id} (Operation: ${payload.id})`);
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

module.exports = { startListeners };
