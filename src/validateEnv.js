const logger = require('./logger').child('Env');

const WEAK_SECRETS = new Set([
  'my_super_secret_key',
  'secret',
  'password',
  'changeme',
  '123456',
  'test',
]);

/**
 * Validates required environment variables at startup.
 * Exits the process on critical misconfiguration.
 */
function validateEnv() {
  const errors = [];

  // ── MONGODB_URI ──
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    errors.push('MONGODB_URI is not set. Provide a valid MongoDB connection string.');
  } else if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    errors.push(`MONGODB_URI must start with "mongodb://" or "mongodb+srv://". Got: "${mongoUri}"`);
  }

  // ── STELLAR_NETWORK ──
  const network = process.env.STELLAR_NETWORK;
  if (!network) {
    logger.warn('STELLAR_NETWORK is not set. Defaulting to TESTNET.');
  } else if (!['TESTNET', 'PUBLIC'].includes(network.toUpperCase())) {
    errors.push(`STELLAR_NETWORK must be "TESTNET" or "PUBLIC". Got: "${network}"`);
  }

  // ── API_PORT (optional) ──
  const port = process.env.API_PORT;
  if (port !== undefined && port !== '') {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      errors.push(`API_PORT must be a number between 1024 and 65535. Got: "${port}"`);
    }
  }

  // ── Report ──
  if (errors.length > 0) {
    logger.error('Environment validation failed:');
    errors.forEach((e, i) => logger.error(`  ${i + 1}. ${e}`));
    process.exit(1);
  }

  logger.info('Environment validated successfully');
}

/**
 * Warn if any watch config uses a weak/example HMAC secret.
 */
function warnWeakSecrets(watches) {
  for (const w of watches) {
    if (WEAK_SECRETS.has(w.hmacSecret)) {
      logger.warn(`Watch "${w.id}" uses a weak/example HMAC secret. Please rotate it before production.`);
    }
  }
}

module.exports = { validateEnv, warnWeakSecrets };
