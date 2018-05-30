
const WebSocket = require('ws');

const config = require('../../config');

/**
 * Sets up a WebSocket connection and an onmessage handler for unit testing.
 * @param {Function} onmessage - Function to execute when client WebSocket received a message from the server.
 * @param {Number} [wait=0] - (Optional) Amount of time to wait before creating a connection to WS server.
 * @param {Number} [port=config.server.port] - (Optional) Overrides the server port to connect to.
 * @param {String} [query='] - (Optional) Query string to append to connection request URL.
 * @return {WebSocket} Returns the websocket that's been setup, when completed
 */
function setupWebsocket(onmessage, wait, port = config.server.port, query = '') {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const url = `ws://127.0.0.1:${port}/live?${query}`;
      const ws = new WebSocket(url);
      ws.onmessage = onmessage;
      ws.onerror = (error) => {
        try {
        // In case the promise has already been rejected
          reject(error);
        } catch (err) { reject(err); }
      };
      resolve(ws);
    }, wait);
  });
}

module.exports = setupWebsocket;
