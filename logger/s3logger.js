
const winston = require('winston');
const { S3 } = require('aws-sdk');

const { time } = require('../util');

/**
 * A custom logger for Winston
 * that logs a file to AWS S3 at a certain interval.
 * Assumes bucket has been created prior to logging.
 * @class S3Logger
 * @extends {winston.Transport}
 */
class S3Logger extends winston.Transport {
  /**
   * Creates an instance of S3Logger.
   * @param {Object} [options={}]
   * @param {String} [options.level='info'] - Log level
   * @param {Number} [options.writeFrequency=20000] - How often the log file will be written to S3
   * @param {String} [options.accessKeyId=null] - AWS access key id for authenticating with S3 services
   * @param {String} [options.secretAccessKey=null] - AWS secret access key for authenticating with S3 services
   * @param {String} [options.region='us-west-1'] - Which region to use for S3
   * @param {String} [options.bucket='neuralyzer'] - S3 bucket to use for the logfile
   * @param {String} [options.filename='neuralyzer.log'] - Filename to use when writing logfile
   * @memberof S3Logger
   */
  constructor(options = {}) {
    super(options);
    this.name = 's3logger';
    this.level = options.level || 'info';
    this.writeFrequency = options.writeFrequency || 1000 * 20; // Write out every 20 seconds
    this.bucket = options.bucket || 'neuralyzer';
    this.filename = options.filename || 'neuralyzer.log';
    this.s3 = new S3({
      accessKeyId: options.accessKeyId || null,
      secretAccessKey: options.secretAccessKey || null,
      region: options.region || 'us-west-1',
    });
    this.writeQueue = [];
    this._writeInterval = null;
    this._write('').then(() => this._initializeWriteInterval());
  }
  /**
   * Writes a string to S3
   * @param {String} strData
   * @returns {Promise}
   * @memberof S3Logger
   */
  _write(strData) {
    return new Promise((resolve, reject) => {
      this.s3.putObject({
        Bucket: this.bucket,
        Key: this.filename,
        Body: strData,
      }, (writeError) => {
        if (writeError) return reject(writeError);
        return resolve();
      });
    });
  }
  /**
   * Writes log queue messages out to S3.
   * @memberof S3Logger
   */
  _toS3() {
    return new Promise((resolve, reject) => {
      this.s3.getObject({
        Bucket: this.bucket,
        Key: this.filename,
      }, (error, data) => {
        if (error) return reject(error);
        const strData = data.Body.toString('utf8');
        return this._write(`${strData}${this.writeQueue.join('\n')}`).then(resolve).catch(reject);
      });
    });
  }
  /**
   * Binds the write interval that logs to S3.
   * @memberof S3Logger
   */
  _initializeWriteInterval() {
    if (this._writeInterval) this._writeInterval = clearInterval(this._writeInterval);
    this._writeInterval = setInterval(() => this._toS3(), this.writeFrequency);
  }
  /**
   * Queues the message up to be logged to S3
   * @param {String} level
   * @param {String} msg - Message to log
   * @param {any} meta - Some metadata
   * @param {Function} callback - Execute when done
   * @memberof S3Logger
   */
  log(level, msg, meta, callback) {
    let toWrite = `${time.dateToUTCString(new Date())} - ${level}: ${msg}`;
    if (Object.keys(meta).length) toWrite += `\n  ${JSON.stringify(meta)}`;
    this.writeQueue.push(toWrite);
    callback(null, true);
  }
}

module.exports = S3Logger;
