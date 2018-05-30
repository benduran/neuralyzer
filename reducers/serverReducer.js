
const uuid = require('uuid/v4');

const { Server } = require('../actionTypes');

// This will become an instance of wss.
// We're going to be cheating here and kind-of mutating the items
// in the wss instance itself.
const defaultState = null;

function serverReducer(state = defaultState, action) {
  switch (action.type) {
    case Server.Init:
      return action.wss;
    case Server.Close:
      return defaultState;
    case Server.Heartbeat:
      for (const client of state.clients) {
        if (client.sid === action.socket.sid) {
          client.connectionAlive = action.connectionAlive;
          client.heartbeatsMissed = action.connectionAlive ? 0 : client.heartbeatsMissed + 1;
          break;
        }
      }
      return state;
    case Server.StaleifyConnection:
      for (const client of state.clients) {
        if (client === action.socket) {
          client.stale = true;
          client.sid = uuid(); // Give a new ID to this socket so we can terminate it without killing the room state
          break;
        }
      }
      return state;
    case Server.StartHeartbeats:
      state.heartbeatsInterval = action.heartbeatsInterval;
      return state;
    case Server.StopHeartbeats:
      state.heartbeatsInterval = clearInterval(state.heartbeatsInterval);
      return state;
    default:
      return state;
  }
}

module.exports = serverReducer;
