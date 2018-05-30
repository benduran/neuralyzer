
const { promisify } = require('util');
const fs = require('fs');
const { Server } = require('http');
const { Server: HttpsServer } = require('https');

const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const express = require('express');

const { version } = require('./package.json');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const routes = require('./routes');
const staleRoomCleaner = require('./staleRoomCleaner');
const { server: serverActions, roomState: roomStateActions, tick: tickActions } = require('./actions');

const readFileAsync = promisify(fs.readFile);

let app = null;
let httpListener = null;
let queueSizeIntervalHandler = null;

function errorHandler(error) {
  logger.error('Unhandled error and / or Promise rejection!');
  logger.error(error);
}

function startQueueSizeLogger() {
  if (queueSizeIntervalHandler) clearInterval(queueSizeIntervalHandler);
  queueSizeIntervalHandler = setInterval(() => {
    logger.info(`Tick Queue Size: ${store.getState().tick.queue.length}`);
  }, 1000 * 30);
}

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
      process.env.APP_NAME = 'neuralyzer';
      app = express();
      if (config.server.ssl.enabled) {
        const options = {
          key: await readFileAsync(config.server.ssl.key, 'utf8'),
          cert: await readFileAsync(config.server.ssl.cert, 'utf8'),
        };
        if (config.server.ssl.ca) options.ca = await readFileAsync(config.server.ssl.ca, 'utf8');
        httpListener = new HttpsServer(options, app);
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

function getState() {
  return store.getState();
}

async function closeAllClients() {
  await store.dispatch(serverActions.disconnectAll());
}

function kill() {
  if (httpListener) httpListener.close();
  return store.dispatch(serverActions.close()).then(() => {
    app = null;
    httpListener = null;
  });
}

if (!module.parent) {
  ((async function () { // eslint-disable-line
    await setup();
  })());
}


exports.setup = setup;
exports.getState = getState;
exports.kill = kill;
exports.closeAllClients = closeAllClients;
