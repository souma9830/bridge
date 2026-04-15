const winston = require('winston');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../../logs');

// ── Custom format: [TIMESTAMP] LEVEL (component): message ──
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: false }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    const tag = component ? ` \x1b[36m(${component})\x1b[0m` : '';
    const extra = Object.keys(meta).length ? `  ${JSON.stringify(meta)}` : '';
    return `\x1b[90m[${timestamp}]\x1b[0m ${level}${tag}: ${message}${extra}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: {},
  transports: [
    // ── Console ──
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // ── Combined logfile ──
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,  // 5 MB
      maxFiles: 5,
      tailable: true,
    }),

    // ── Error-only logfile ──
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

/**
 * Create a child logger scoped to a specific component.
 * Usage: const log = require('./utils/logger').child('Listener');
 *        log.info('Stream started');
 */
logger.child = (component) => {
  const childMeta = typeof component === 'string' ? { component } : component;
  return {
    info:  (msg, meta = {}) => logger.info(msg, { ...childMeta, ...meta }),
    warn:  (msg, meta = {}) => logger.warn(msg, { ...childMeta, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { ...childMeta, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { ...childMeta, ...meta }),
  };
};

module.exports = logger;
