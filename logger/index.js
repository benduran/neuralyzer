
const winston = require('winston');

const S3Logger = require('./s3logger');
const { time } = require('../util');
const { logging } = require('../config');

function timestampFormat() {
  return time.dateToUTCString(new Date());
}

function createLoggers() {
  const logger = new winston.Logger({
    transports: [
      new winston.transports.Console({
        colorize: true,
        level: logging.console.level,
        timestamp: timestampFormat,
      }),
    ],
    exceptionHandlers: [
      new winston.transports.Console({
        colorize: true,
        level: logging.console.level,
        timestamp: timestampFormat,
      }),
    ],
  });
  if (logging.s3.enabled) {
    if (!logging.s3.bucket) logger.error('Cannot use S3 logger because not bucket was provided');
    else {
      logger.add(new S3Logger({
        bucket: logging.s3.bucket,
        level: logging.s3.level,
        filename: logging.s3.filename,
        accessKeyId: logging.s3.accessKeyId,
        secretAccessKey: logging.s3.secretAccessKey,
      }), true);
    }
  }
  return logger;
}

module.exports = createLoggers();
