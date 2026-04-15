const express = require('express');
const mongoose = require('mongoose');
const logger = require('./utils/logger').child('API');
const metrics = require('./utils/metrics');
const { getDLQStats } = require('./services/dlqProcessor');
const DeadLetter = require('./db/DeadLetter');
const { dispatchWebhook } = require('./services/dispatcher');

const app = express();
app.use(express.json());

// ───────────────────────────────────────────────
// GET /health
// ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  res.json({
    status: mongoState === 1 ? 'ok' : 'degraded',
    uptime: metrics.getUptime(),
    mongo: mongoStatus[mongoState] || 'unknown',
    network: process.env.STELLAR_NETWORK || 'TESTNET',
    timestamp: new Date().toISOString(),
  });
});

// ───────────────────────────────────────────────
// GET /status
// ───────────────────────────────────────────────
app.get('/status', async (req, res) => {
  try {
    const snap = metrics.getSnapshot();
    const dlq = await getDLQStats();
    const mem = process.memoryUsage();

    res.json({
      uptime: snap.uptime,
      uptimeFormatted: metrics.getUptime(),
      metrics: {
        operationsReceived: snap.global.operationsReceived,
        operationsMatched: snap.global.operationsMatched,
        webhooksDispatched: snap.global.webhooksDispatched,
        webhooksFailed: snap.global.webhooksFailed,
      },
      perWatch: snap.perWatch,
      dlq,
      memory: {
        heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
        rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────
// GET /dlq
// ───────────────────────────────────────────────
app.get('/dlq', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const entries = await DeadLetter.find({ status })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const stats = await getDLQStats();

    res.json({
      stats,
      entries: entries.map((e) => ({
        id: e._id,
        watchId: e.watchId,
        webhookUrl: e.webhookUrl,
        error: e.error,
        attempts: e.attempts,
        maxAttempts: e.maxAttempts,
        status: e.status,
        nextRetryAt: e.nextRetryAt,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────
// POST /dlq/:id/retry
// ───────────────────────────────────────────────
app.post('/dlq/:id/retry', async (req, res) => {
  try {
    const entry = await DeadLetter.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Dead letter entry not found' });
    }

    try {
      await dispatchWebhook(entry.payload, {
        webhookUrl: entry.webhookUrl,
        hmacSecret: entry.hmacSecret,
      }, true);

      await DeadLetter.deleteOne({ _id: entry._id });
      metrics.inc('dlqPending', -1);

      res.json({ status: 'dispatched', message: 'Webhook dispatched successfully and entry removed' });
    } catch (err) {
      entry.attempts += 1;
      entry.error = err.message;
      if (entry.attempts >= entry.maxAttempts) {
        entry.status = 'exhausted';
      }
      await entry.save();

      res.status(502).json({
        status: 'failed',
        message: `Retry failed: ${err.message}`,
        attempts: entry.attempts,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Start the API server on the configured port.
 */
function startAPI() {
  const port = parseInt(process.env.API_PORT) || 9100;

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`API server listening on http://localhost:${port}`);
      logger.info(`  GET  /health   — Service health check`);
      logger.info(`  GET  /status   — Metrics & stream status`);
      logger.info(`  GET  /dlq      — Dead letter queue entries`);
      logger.info(`  POST /dlq/:id/retry — Force-retry a DLQ entry`);
      resolve(server);
    });
  });
}

module.exports = { app, startAPI };
