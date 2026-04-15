/**
 * Lightweight in-memory metrics counters.
 * No external dependency — just a plain object with helper functions.
 */
const counters = {
  operationsReceived: 0,
  operationsMatched: 0,
  webhooksDispatched: 0,
  webhooksFailed: 0,
  dlqPending: 0,
  dlqExhausted: 0,
  startedAt: Date.now(),
};

// Per-watch counters: { watchId: { matched, dispatched, failed } }
const perWatch = {};

function inc(key, amount = 1) {
  if (counters[key] !== undefined) {
    counters[key] += amount;
  }
}

function incWatch(watchId, key, amount = 1) {
  if (!perWatch[watchId]) {
    perWatch[watchId] = { matched: 0, dispatched: 0, failed: 0 };
  }
  if (perWatch[watchId][key] !== undefined) {
    perWatch[watchId][key] += amount;
  }
}

function getSnapshot() {
  return {
    uptime: Math.floor((Date.now() - counters.startedAt) / 1000),
    global: { ...counters },
    perWatch: JSON.parse(JSON.stringify(perWatch)),
  };
}

function getUptime() {
  const secs = Math.floor((Date.now() - counters.startedAt) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = { counters, perWatch, inc, incWatch, getSnapshot, getUptime };
