const fs = require('fs');
const path = require('path');
const logger = require('./logger').child('Config');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');

/**
 * Validates a single watch configuration object.
 * Returns an array of error strings (empty = valid).
 */
function validateWatch(watch, index) {
  const errors = [];
  const prefix = `watches[${index}]`;

  if (!watch.id || typeof watch.id !== 'string') {
    errors.push(`${prefix}.id is required and must be a string`);
  }

  if (!watch.address || typeof watch.address !== 'string') {
    errors.push(`${prefix}.address is required and must be a valid Stellar address`);
  } else if (!/^G[A-Z2-7]{55}$/.test(watch.address)) {
    errors.push(`${prefix}.address "${watch.address}" is not a valid Stellar public key`);
  }

  if (!watch.webhookUrl || typeof watch.webhookUrl !== 'string') {
    errors.push(`${prefix}.webhookUrl is required`);
  } else {
    try {
      new URL(watch.webhookUrl);
    } catch {
      errors.push(`${prefix}.webhookUrl "${watch.webhookUrl}" is not a valid URL`);
    }
  }

  if (!watch.hmacSecret || typeof watch.hmacSecret !== 'string') {
    errors.push(`${prefix}.hmacSecret is required`);
  }

  if (watch.minAmount !== undefined) {
    const amt = parseFloat(watch.minAmount);
    if (isNaN(amt) || amt < 0) {
      errors.push(`${prefix}.minAmount must be a non-negative number`);
    }
  }

  if (watch.operationTypes !== undefined) {
    if (!Array.isArray(watch.operationTypes)) {
      errors.push(`${prefix}.operationTypes must be an array`);
    }
  }

  return errors;
}

/**
 * Loads and validates config.json.
 * Throws on invalid configuration.
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config.json: ${err.message}`);
  }

  if (!config.watches || !Array.isArray(config.watches)) {
    throw new Error('config.json must contain a "watches" array');
  }

  const allErrors = [];
  config.watches.forEach((w, i) => {
    allErrors.push(...validateWatch(w, i));
  });

  if (allErrors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${allErrors.join('\n  - ')}`);
  }

  // Apply defaults
  config.watches = config.watches.map((w) => ({
    operationTypes: ['payment', 'path_payment_strict_send', 'path_payment_strict_receive'],
    ...w,
  }));

  logger.info(`Loaded ${config.watches.length} watch configuration(s)`);
  return config;
}

/**
 * Watches config.json for changes and calls the callback with the new config.
 * Returns a function to stop watching.
 */
function watchConfigFile(onChange) {
  let debounce = null;

  const watcher = fs.watch(CONFIG_PATH, (eventType) => {
    if (eventType !== 'change') return;

    // Debounce rapid file events
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        const newConfig = loadConfig();
        logger.info('Config file changed — hot-reloading watches');
        onChange(newConfig);
      } catch (err) {
        logger.error(`Hot-reload failed: ${err.message}. Keeping current config.`);
      }
    }, 500);
  });

  logger.info('Watching config.json for live changes');

  return () => {
    watcher.close();
    if (debounce) clearTimeout(debounce);
  };
}

module.exports = { loadConfig, watchConfigFile, validateWatch };
