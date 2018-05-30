
const roomsRoutes = require('./rooms');
const debugRoutes = require('./debug');

/**
 * Returns array of all REST API routes for querying and accessing Neuralyzer data.
 * @param {Function} authMiddleware - (Optional) Middleware to determine whether or not a user can access the different routes APIs.
 * @returns {Function[]} Array of route middlewares.
 */
function routes() {
  const r = [roomsRoutes(), debugRoutes()];
  return r;
}

module.exports = routes;
