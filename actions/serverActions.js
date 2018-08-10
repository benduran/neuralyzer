
const urlParse = require('url');

const uuid = require('uuid/v4');
const { Server: WsServer } = require('ws');

const logger = require('../logger');
const config = require('../config');
const roomStateActions = require('./roomStateActions');
const { Participant, SocketMessage } = require('../models');
const { Server } = require('../actionTypes');
const tickActions = require('./tickActions');
const { RoomEvents, SocketEvents } = require('../constants');

/**
 * Called when a socket has disconnected from the server.
 * Causes the connected user to leave the room their socket was assigned to.
 * @param {WebSocket} socket - Socket that has disconnected
 */
function disconnected(socket) {
  return async (dispatch) => {
    dispatch({ type: Server.Disconnected, socket });
    await dispatch(roomStateActions.leaveUserFromRoom(socket.sid));
  };
}

/**
 * Forceably disconnects a websocket connection.
 * @param {WebSocket} socket - Websocket to forcefull disconnect
 */
function forceDisconnect(socket) {
  return async (dispatch) => {
    socket.terminate();
    await dispatch(disconnected(socket));
  };
}

/**
 * Disconnects all currently connected clients from the current server instance.
 */
function disconnectAll() {
  return (dispatch, getState) => new Promise((resolve, reject) => {
    const { server } = getState();
    if (server) {
      // cannot map on a Set(), must manually map
      const all = [];
      server.clients.forEach(c => all.push(new Promise(async (disconnectResolve, disconnectReject) => {
        try {
          await dispatch(forceDisconnect(c));
        } catch (error) { disconnectReject(error); }
      })));
      return Promise.all(all).then(resolve).catch(reject);
    }
    return resolve();
  });
}

/**
 * Updates socket's heartbeat status in redux.
 * @param {WebSocket} socket
 * @param {Boolean} connectionAlive - True if socket is still alive, false if otherwise
 */
function heartbeat(socket, connectionAlive) {
  logger.info(`${socket.useragent} sent heartbeat "pulse"`);
  return { type: Server.Heartbeat, socket, connectionAlive };
}

/**
 * Creates a new room, or joins a room in progress.
 * NOTE: This function is a special case use of the tick rate.
 * By using the tick rate, we are ensuring that create room requests are
 * processed IN ORDER, thus preventing race conditions.
 * @param {WebSocket} socket - Socket that's trying to create or join room
 * @param {Object} data - Room creation request
 */
function createOrJoinRoom(socket, data) {
  return (dispatch) => {
    dispatch(tickActions.enqueue(async () => {
      let disconnect = false;
      if (!data) {
        logger.error(`Unable to connect to ${process.env.APP_NAME} because no params were provided.`);
        disconnect = true;
      }
      const { room, username, userId, deviceType } = data;
      if (!room) {
        logger.error(`Unable to connect to ${process.env.APP_NAME} because no room was specified.`);
        disconnect = true;
      } else if (!username) {
        logger.error(`Unable to connect to ${process.env.APP_NAME} because no username was specified.`);
        disconnect = true;
      } else if (!userId) {
        logger.error(`Unable to connect to ${process.env.APP_NAME} because no userId was specified.`);
        disconnect = true;
      }
      if (disconnect) {
        socket.close();
      } else {
      // Okay, if we got here, we need to create the room in Redis if it doesn't exist
        try {
        // TODO: We should probably disallow explicit setting of the participant ID here.
        // For now, it's fine, but we definitely need to come back to this
          const userToJoin = new Participant({ name: username, id: userId, device: deviceType, sid: socket.sid });
          await dispatch(roomStateActions.createOrJoinRoom(room, userToJoin));
          // Assign a unique ID to this websocket
          await dispatch(roomStateActions.assignSocketIdToRoom(room, socket.sid));
        } catch (error) {
          disconnect = true;
          logger.error(error);
        }
      }
    }));
  };
}

/**
 * Processes a websocket client's message that has been sent to the server.
 * @param {WebSocket} socket - Socket that's sent a message to the server
 * @param {SocketMessage} data - Socket message sent my WebSocket
 */
function handleMessage(socket, data) {
  return async (dispatch) => {
    try {
      const parsed = SocketMessage.fromWire(data);
      if (parsed.msgType === SocketEvents.Blip) return dispatch(heartbeat(socket, true));
      switch (parsed.msgType) {
        case SocketEvents.CreateOrJoinRoom:
          return dispatch(createOrJoinRoom(socket, parsed.data));
        case RoomEvents.RoomStateUpdate:
          return dispatch(roomStateActions.updateRoomState(socket.sid, parsed.data));
        default:
          return null;
      }
    } catch (error) {
      return logger.error(error);
    }
  };
}

/**
 * Binds all events to a socket that has just connected to the server.
 * Sends a ConnectionReady event back to the socket that connected.
 * @param {WebSocket} socket
 * @param {Request} req - HTTP request object
 */
function connected(socket, req) {
  return async (dispatch, getState) => {
    // Socket has connected successfully.
    // Bind socket message handlers and send message back to client that
    // all's good in the neighborhood

    // If an sid was provided on the URL via the querystring,
    // we should "attempt" to reconnect the user with the same socket information
    // and automatically join them to the room they were in previously
    const { query } = urlParse.parse(req.url, true); // Query should be parsed into an object here.
    const pleaseReconnect = query && query.sid;
    let existingConnectionMatch = null;
    if (pleaseReconnect) {
      for (const client of getState().server.clients) {
        if (client.sid === query.sid) {
          existingConnectionMatch = client;
          break;
        }
      }
    }
    socket.connectionAlive = true;
    socket.sid = pleaseReconnect ? query.sid : uuid();
    socket.heartbeatsMissed = 0;
    socket.useragent = req.headers['user-agent'] || 'Unknown';
    socket.on('close', () => dispatch(disconnected(socket)));
    socket.on('message', msg => dispatch(handleMessage(socket, msg)));
    // Need to add an error handler to all sockets to catch uncaught exceptions,
    // including socket hangup disconnect events (as documented via this recent WS package issue: https://github.com/websockets/ws/issues/1256)
    socket.on('error', async (error) => {
      logger.warn(`Socket caused error: ${error.message}`);
      logger.warn(`Forcing disconnect of socket sid ${socket.sid}`);
      return dispatch(forceDisconnect(socket));
    });
    socket.send(new SocketMessage({
      msgType: SocketEvents.ConnectionReady,
      data: socket.sid,
    }).toWire());
    if (pleaseReconnect) {
      const socketToExpire = await dispatch(roomStateActions.attemptReconnect(socket, existingConnectionMatch));
      if (socketToExpire) await dispatch(forceDisconnect(socketToExpire));
    }
  };
}

/**
 * Starts the heartbeat interval that will check for stale connections.
 */
function startHeartbeats() {
  return (dispatch, getState) => {
    const heartbeatsInterval = setInterval(() => {
      const { clients } = getState().server;
      logger.info(`Sending ${clients.size} heartbeat${clients.size > 1 ? 's' : ''}`);
      clients.forEach((socket) => {
        if (!socket.connectionAlive && socket.heartbeatsMissed > config.server.sockets.heartbeatMissedThreshold) {
          // If the connnection isn't alive anymore AND the connection missed more than a certain number of heartbeats,
          // then it is truly dead and gone. Forcefully disconnect the socket.
          dispatch(forceDisconnect(socket));
        } else {
          try {
            // Mark the socket as not active, and wait for it to respond with a blip before marking as active again.
            // This will also increment the heartbeatsMissed counter.
            dispatch(heartbeat(socket, false));
            if (socket.readyState === socket.OPEN && !socket.stale) {
              socket.send(new SocketMessage({
                msgType: SocketEvents.Pulse,
              }).toWire());
            }
          } catch (error) { logger.error(error); }
        }
      });
    }, config.server.sockets.heartbeatInterval);
    logger.info(`Heartbeats interval started and executing every ${config.server.sockets.heartbeatInterval / 1000} seconds`);
    dispatch({ type: Server.StartHeartbeats, heartbeatsInterval });
  };
}

/**
 * Terminates the heartbeat interval
 */
function stopHeartbeats() {
  return { type: Server.StopHeartbeats };
}

/**
 * Starts the websocket server and maps it to the current Express HttpListener instance.
 * Binds all events required for the web socket server.
 * @param {HttpListener} httpListener
 */
function init(httpListener) {
  return (dispatch, getState) => new Promise((resolve, reject) => {
    try {
      if (getState().server) logger.error('Cannot init WSS server as it has already been initialized.');
      else if (!httpListener) throw new Error('No httpListener was provided when Connections.setup() called.');
      else {
        const wss = new WsServer({
          server: httpListener,
          path: config.server.sockets.path,
        // verifyClient: () => {}, // TODO: Add this to put an auth layer in between requests and connections
        });
        dispatch({ type: Server.Init, wss });
        // All server handlers are bound here
        wss.on('connection', (...args) => dispatch(connected(...args)));
        dispatch(startHeartbeats());
        resolve();
        logger.info(`Neuralyzer has been started and is listening for connections on ${config.server.hostname}:${config.server.port}`);
      }
    } catch (error) { reject(error); }
  });
}

exports.heartbeat = heartbeat;
exports.handleMessage = handleMessage;
exports.connected = connected;
exports.disconnected = disconnected;
exports.forceDisconnect = forceDisconnect;
exports.init = init;
exports.stopHeartbeats = stopHeartbeats;
exports.disconnectAll = disconnectAll;
exports.createOrJoinRoom = createOrJoinRoom;
