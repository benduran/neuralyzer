
const uuid = require('uuid/v4');

const tickRate = !Number.isNaN(parseInt(process.env.NEURALYZER_TICK_RATE, 10))
  ? parseInt(process.env.NEURALYZER_TICK_RATE, 10)
  : 50; // Defaults to 20hz
const staleRoomCleanerInterval = !Number.isNaN(parseInt(process.env.NEURALYZER_STALE_ROOM_CLEANER_INTERVAL, 10))
  ? parseInt(process.env.NEURALYZER_STALE_ROOM_CLEANER_INTERVAL, 10)
  : 1000 * 30;
const heartbeatInterval = !Number.isNaN(parseInt(process.env.NEURALYZER_HEARTBEAT_INTERVAL, 10))
  ? parseInt(process.env.NEURALYZER_HEARTBEAT_INTERVAL, 10)
  : 5000;
const heartbeatMissedThreshold = !Number.isNaN(parseInt(process.env.NEURALYZER_HEARTBEAT_MISSED_THRESHOLD, 10))
  ? parseInt(process.env.NEURALYZER_HEARTBEAT_MISSED_THRESHOLD, 10)
  : 3;
const hstsMaxAge = !Number.isNaN(parseInt(process.env.NEURALYZER_HSTS_MAX_AGE, 10))
  ? parseInt(process.env.NEURALYZER_HSTS_MAX_AGE, 10)
  : 60 * 60 * 24 * 365; // Defaults to one year of max-age HSTS security

module.exports = {
  server: {
    id: process.env.NEURALYZER_SERVER_ID || uuid(),
    port: process.env.NEURALYZER_SERVER_PORT || 8081, // If you change this here, you need to also change it in the Dockerfile!
    hostname: process.env.NEURALYZER_SERVER_HOSTNAME || '0.0.0.0',
    sockets: {
      path: process.env.NEURALYZER_SOCKET_PATH || '/live',
      heartbeatInterval,
      heartbeatMissedThreshold,
      flatbuffers: { enabled: process.env.NEURALYZER_FLAT_BUFFERS_ENABLED === 'true' },
    },
    tickRate,
    staleRoomCleanerInterval,
    ssl: {
      enabled: process.env.NEURALYZER_SSL_ENABLED === 'true',
      cert: process.env.NEURALYZER_SSL_CERT || '',
      key: process.env.NEURALYZER_SSL_KEY || '',
      ca: process.env.NEURALYZER_SSL_CA || '',
      hsts: process.env.NEURALYZER_HSTS_ENABLED === 'true',
      hstsIncludeSubdomains: process.env.NEURALYZER_HSTS_INCLUDE_SUBDOMAINS === 'true',
      hstsMaxAge,
    },
  },
  redis: {
    host: process.env.NEURALYZER_REDIS_HOST || '127.0.0.1',
    port: process.env.NEURALYZER_REDIS_PORT || 6379,
    password: process.env.NEURALYZER_REDIS_PASSWORD || null,
  },
  logging: {
    uncaughtExceptions: process.env.NEURALYZER_LOG_UNCAUGHT_EXCEPTIONS === 'true' || false,
    console: {
      enabled: process.env.NEURALYZER_CONSOLE_LOGGER_ENABLED === 'true' || false,
      level: process.env.NEURALYZER_CONSOLE_LOG_LEVEL || 'verbose',
    },
    s3: {
      enabled: process.env.NEURALYZER_S3_LOGGER_ENABLED === 'true',
      accessKeyId: process.env.NEURALYZER_S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.NEURALYZER_S3_SECRET_ACCESS_KEY || '',
      bucket: process.env.NEURALYZER_S3_LOG_BUCKET || '',
      level: process.env.NEURALYZER_S3_LOG_LEVEL || 'verbose',
      filename: process.env.NEURALYZER_S3_LOG_FILENAME || 'neuralyzer.log',
    },
  },
};
