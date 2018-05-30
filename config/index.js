
const uuid = require('uuid/v4');

const DEFAULT_STALE_ROOM_CLEANER_INTERVAL = 1000 * 30;

module.exports = {
  server: {
    id: process.env.NEURALYZER_SERVER_ID || uuid(),
    port: process.env.NEURALYZER_SERVER_PORT || 8081, // If you change this here, you need to also change it in the Dockerfile!
    hostname: process.env.NEURALYZER_SERVER_HOSTNAME || '0.0.0.0',
    sockets: {
      path: '/live',
      heartbeatInterval: 5000,
      heartbeatMissedThreshold: 3,
      flatbuffers: {
        enabled: process.env.NEURALYZER_FLAT_BUFFERS_ENABLED === 'true',
      },
    },
    tickRate: !Number.isNaN(parseInt(process.env.NEURALYZER_TICK_RATE, 10)) ? parseInt(process.env.NEURALYZER_TICK_RATE, 10) : 50, // Defaults to 20hz
    staleRoomCleanerInterval: !Number.isNaN(parseInt(process.env.NEURALYZER_STALE_ROOM_CLEANER_INTERVAL, 10)) ? parseInt(process.env.NEURALYZER_STALE_ROOM_CLEANER_INTERVAL, 10) : DEFAULT_STALE_ROOM_CLEANER_INTERVAL,
    ssl: {
      enabled: process.env.NEURALYZER_SSL_ENABLED === 'true',
      cert: process.env.NEURALYZER_SSL_CERT || '',
      key: process.env.NEURALYZER_SSL_KEY || '',
      ca: process.env.NEURALYZER_SSL_CA || '',
    },
  },
  redis: {
    host: process.env.NEURALYZER_REDIS_HOST || '127.0.0.1',
    port: process.env.NEURALYZER_REDIS_PORT || 6379,
    password: process.env.NEURALYZER_REDIS_PASSWORD || null,
  },
  logging: {
    console: {
      enabled: true, // TODO: We can make this configurable in the future, but for now, it's always on
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
