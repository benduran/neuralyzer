
const { promisify } = require('util');
const fs = require('fs');
const { Server } = require('http');
const { Server: HttpsServer } = require('https');

const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');

const { version } = require('./package.json');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const routes = require('./routes');
const middleware = require('./middleware');
const staleRoomCleaner = require('./staleRoomCleaner');
const { server: serverActions, roomState: roomStateActions, tick: tickActions } = require('./actions');

const readFileAsync = promisify(fs.readFile);

let app = null;
let httpListener = null;
let queueSizeIntervalHandler = null;

/**
 * Handles uncaught errors / exceptions
 * @param {Error} error - Error that was thrown
 * @private
 */
function errorHandler(error) {
  logger.error('Unhandled error and / or Promise rejection!');
  logger.error(error);
}

/**
 * Starts a logger that, ever 30 seconds,
 * logs the size of the tick queue.
 * Only used when the server is executed with NEURALYZER_NODE_ENV set to "test" or "debug."
 * @private
 */
function startQueueSizeLogger() {
  if (queueSizeIntervalHandler) clearInterval(queueSizeIntervalHandler);
  queueSizeIntervalHandler = setInterval(() => {
    logger.info(`Tick Queue Size: ${store.getState().tick.queue.length}`);
  }, 1000 * 30);
}

/**
 * Creates the Neuralyuzer Express API app, binds the endpoints,
 * initializes Neuralyuzer's connection to Redis, starts the heartbeat ticker,
 * and starts Neuralyzer listening for WS or WSS connections.
 * @returns {Object} An object containing Neuralyzer's HTTP/S listener and its associated Express app { httpListener, app }.
 */
function setup() {
  return new Promise(async (resolve, reject) => {
    process.on('uncaughtException', errorHandler);
    process.on('unhandledRejection', errorHandler);
    try {
      if (process.env.DISABLE_LOGGING === 'yes') {
        Object.keys(logger.transports).forEach((t) => {
          logger.transports[t].silent = true;
        });
      }
      app = express();
      if (config.server.ssl.enabled) {
        const options = {
          key: await readFileAsync(config.server.ssl.key, 'utf8'),
          cert: await readFileAsync(config.server.ssl.cert, 'utf8'),
        };
        if (config.server.ssl.ca) options.ca = await readFileAsync(config.server.ssl.ca, 'utf8');
        httpListener = new HttpsServer(options, app);
        if (config.server.ssl.hsts) app.use(middleware.hsts());
      } else httpListener = Server(app);
      app.use(cors());
      app.use(cookieParser());
      app.use(bodyParser.json()); // Only support JSON bodies. We're not a forms-based app
      app.use('/api', routes());
      await store.dispatch(roomStateActions.setupServerSubscriptions());
      await store.dispatch(roomStateActions.synchronizeWithRedis());
      await store.dispatch(serverActions.init(httpListener));
      store.dispatch(tickActions.startTicker());
      httpListener.listen(config.server.port, config.server.hostname, () => {
        logger.info(`Listening for connections on http${config.server.ssl.enabled ? 's' : ''}://${config.server.hostname}:${config.server.port}`);
        resolve({ app, httpListener });
      });
      if (process.env.NEURALYZER_NODE_ENV === 'test' || process.env.NEURALYZER_NODE_ENV === 'debug') startQueueSizeLogger();
      app.get('/', (req, res) => res.send(`Neuralyzer v${version}`));
      await staleRoomCleaner();
    } catch (error) { reject(error); }
  });
}

/**
 * Returns a copy of the Neuralyzer Redux application state.
 * Useful for testing if changes are being applied correctly.
 * DO NOT MUTATE DIRECTLY!
 * @returns {Object} Neuralyzer Reduyx state
 */
function getState() {
  return store.getState();
}

/**
 * Forcefully closes all connections to connected WS/S clients.
 * @returns {Promise}
 */
async function closeAllClients() {
  await store.dispatch(serverActions.disconnectAll());
}

/**
 * Kills the Neuralyzer process by stopping all listeners,
 * terminating the heartbeat interval, and disconnecting from Redis.
 * @param {HttpListener|HttpsListener} httpListener - Neuralyzer's HTTP/S listener that was returned from initial setup
 * @returns {Promise}
 */
function kill() {
  if (httpListener) httpListener.close();
  return store.dispatch(serverActions.close()).then(() => {
    app = null;
    httpListener = null;
  });
}

exports.setup = setup;
exports.getState = getState;
exports.kill = kill;
exports.closeAllClients = closeAllClients;

if (!module.parent) {
  ((async function () { // eslint-disable-line
    await setup();
  })());
}
