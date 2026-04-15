require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('./utils/logger').child('Main');
const { validateEnv, warnWeakSecrets } = require('./utils/validateEnv');
const { loadConfig, watchConfigFile } = require('./utils/configLoader');
const { connectDB } = require('./db/connection');
const { startListeners, stopAllStreams, getActiveStreams } = require('./services/listener');
const { startDLQProcessor, stopDLQProcessor } = require('./services/dlqProcessor');
const { startAPI } = require('./api');
const { startDashboard, stopDashboard, setActiveStreams } = require('./utils/dashboard');
const metrics = require('./utils/metrics');

// ── ASCII banner ──
const BANNER = `
\x1b[35m╔═══════════════════════════════════════════════════╗
║                                                   ║
║   ★  STELLAR-TO-WEB2 HOOK  ★                      ║
║      Bridging blockchain to your backend           ║
║                                                    ║
╚═══════════════════════════════════════════════════╝\x1b[0m
`;

async function main() {
  console.log(BANNER);

  // 1. Validate environment
  validateEnv();

  // 2. Connect to MongoDB
  await connectDB();

  // 3. Load & validate config
  const config = loadConfig();
  const watches = config.watches || [];

  if (watches.length === 0) {
    logger.warn('No watches defined in config.json. Exiting...');
    process.exit(0);
  }

  warnWeakSecrets(watches);

  logger.info(`Loaded ${watches.length} watch configuration(s)`);
  watches.forEach((w) => {
    logger.info(`  → ${w.id}: ${w.address.substring(0, 8)}…  [${w.operationTypes.join(', ')}]`);
  });

  // 4. Start the Stellar operation streams
  await startListeners(watches);

  // 5. Start the DLQ processor
  startDLQProcessor();

  // 6. Start the Health/Status API
  const apiServer = await startAPI();

  // 7. Start the CLI dashboard if --dashboard flag is present
  const dashboardMode = process.argv.includes('--dashboard');
  if (dashboardMode) {
    setActiveStreams(getActiveStreams());
    startDashboard();
  }

  // 8. Watch config for hot-reload
  const stopConfigWatch = watchConfigFile(async (newConfig) => {
    logger.info('Hot-reloading: stopping current streams...');
    stopAllStreams();
    logger.info('Hot-reloading: starting new streams...');
    await startListeners(newConfig.watches);
    if (dashboardMode) {
      setActiveStreams(getActiveStreams());
    }
  });

  // ── Graceful Shutdown ──
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Stop dashboard
    if (dashboardMode) {
      stopDashboard();
    }

    // Stop config watcher
    stopConfigWatch();

    // Stop DLQ processor
    stopDLQProcessor();

    // Stop all Stellar streams
    stopAllStreams();

    // Close API server
    if (apiServer) {
      await new Promise((resolve) => {
        apiServer.close(() => {
          logger.info('API server closed');
          resolve();
        });
      });
    }

    // Wait for in-flight dispatches (generous timeout)
    logger.info('Waiting for in-flight dispatches (10s timeout)...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Disconnect MongoDB
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    } catch (err) {
      logger.error(`MongoDB disconnect error: ${err.message}`);
    }

    logger.info('Shutdown complete. Goodbye! ★');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('Service is running — listening for Stellar operations ★');
}

main().catch((error) => {
  logger.error(`Fatal initialization error: ${error.message}`, { stack: error.stack });
  process.exit(1);
});
