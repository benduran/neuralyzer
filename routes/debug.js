
const { Router } = require('express');

const store = require('../store');

/**
 * Returns important information about this server's current state.
 * Useful for troubleshooting while developing or for writing tests.
 * @param {Request} req - HTTP request object
 * @param {Response} res - HTTP response object
 */
function getServerState(req, res) {
  const state = store.getState();
  const connections = [];
  for (const client of state.server.clients) connections.push(client);
  res.json({
    rooms: state.roomState.rooms,
    connections: connections.map(c => ({ sid: c.sid, connectionAlive: c.connectionAlive, stale: c.stale, readyState: c.readyState })),
  });
}

function debugRoutes() {
  const router = new Router();
  router.route('/server/state').get(getServerState);
  return router;
}

module.exports = debugRoutes;
