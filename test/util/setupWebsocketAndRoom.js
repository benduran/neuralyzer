
const setupWebsocket = require('./setupWebsocket');
const { SocketMessage, CreateJoinRequest } = require('../../models');
const { SocketEvents } = require('../../constants');
const config = require('../../config');

/**
 * Sets up a websocket, waits for the connection to complete, and joins a room.
 * @param {Object} args
 * @param {String} args.room - Name of room to join when connected.
 * @param {String} args.username - Username of user when they enter the room.
 * @param {String|Number} args.userId - User's ID when they enter the room.
 * @param {String} args.device - Identifier for what device type the user is connecting from. Can be any string.
 * @param {Function} args.onmessage - Function to execute when client WebSocket received a message from the server.
 * @param {Number} [args.wait=0] - (Optional) Amount of time to wait before creating a connection to WS server.
 * @param {Boolean} [args.allowPulse=false] - (Optional) If true, allows the pulse messages to permeate back up to the onmessage handler provided.
 * @param {Number} [args.port=config.server.port] - (Optional) Overrides the server port to connect to.
 * @param {String} [args.query='] - (Optional) Query string to append to connection request URL.
 */
function setupWebsocketAndRoom({
  room,
  username,
  userId,
  device,
  onmessage,
  wait = 0,
  allowPulse = false,
  port = config.server.port,
  query = '',
}) {
  return new Promise((resolve, reject) => {
    let socket = null;
    let timeout = null;
    function toSend(msg) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
    function superOnMessage({ data }) {
      let parsed = null;
      try {
        parsed = SocketMessage.fromWire(data);
      } catch (error) {
        parsed = data;
      }
      if (parsed.msgType === SocketEvents.Pulse) {
        if (!allowPulse) return toSend(new SocketMessage({ msgType: SocketEvents.Blip }).toWire());
        // Make the caller manually handle the pulses
        return onmessage({ data: parsed });
      }
      if (typeof parsed === 'object' && parsed.msgType === SocketEvents.ConnectionReady) {
        timeout = clearTimeout(timeout);
        toSend(new SocketMessage({
          data: new CreateJoinRequest(room, username, userId.toString(), device),
          msgType: SocketEvents.CreateOrJoinRoom,
        }).toWire());
        resolve(socket);
      }
      return onmessage({ data: parsed });
    }
    setupWebsocket(superOnMessage, wait, port, query).then((s) => {
      socket = s;
      timeout = setTimeout(() => {
        timeout = clearTimeout(timeout);
        reject(new Error('Socket never received socket:ready event.'));
      }, config.server.sockets.heartbeatInterval);
    }).catch(reject);
  });
}

module.exports = setupWebsocketAndRoom;
