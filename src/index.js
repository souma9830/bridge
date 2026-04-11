require('dotenv').config();
const { connectDB } = require('./db/connection');
const { startListeners } = require('./services/listener');
const config = require('./config.json');

async function main() {
  console.log('Starting Stellar-to-Web2 Hook Service...');
  
  // 1. Connect to MongoDB
  await connectDB();
  
  // 2. Load Watches
  const watches = config.watches || [];
  if (watches.length === 0) {
    console.warn('No watches defined in config.json. Exiting...');
    process.exit(0);
  }
  
  console.log(`Loaded ${watches.length} watch configuration(s).`);
  
  // 3. Start Streaming
  await startListeners(watches);
  
  // Handle unexpected shutdown gracefully
  process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down...');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down...');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal initialization error:', error);
  process.exit(1);
});
