
const { Router } = require('express');

const store = require('../store');
const { objects } = require('../util');

/**
 * Queries Redux store and gets array of all rooms in the server's state,
 * which should be synchronized with Redis cache.
 * @param {Request} req - HTTP request object
 * @param {Response} res - HTTPS response object
 */
function getAllRooms(req, res) {
  res.json(Object.values(store.getState().roomState.rooms || {}).map(r => Object.assign(objects.pick(r, 'id', 'name'), {
    participants: r.participants.map(p => objects.pick(p, 'name', 'device')),
  })));
}

/**
 * Queries the REdux store to get some pertinent information about the current state of a specific room.
 * @param {Request} req - HTTP request object.
 * @param {Response} res - HTTP response object.
 */
function getRoomDetails(req, res) {
  const room = Object.values(store.getState().roomState.rooms).find(r => r.name === req.params.roomName);
  if (!room) return res.sendStatus(404);
  return res.json({
    id: room.id,
    participants: room.participants.map(p => objects.pick(p, 'name', 'device')),
    name: room.name,
  });
}

/**
 * Maps all routes related to getting rooms and room data.
 * @return {Router} Instance of Express router.
 */
function rooms() {
  const router = new Router();
  router.route('/room/:roomName').get(getRoomDetails);
  router.route('/rooms').get(getAllRooms);
  return router;
}

module.exports = rooms;
