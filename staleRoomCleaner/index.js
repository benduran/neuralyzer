
const { server } = require('../config');
const Client = require('../redisClient');
const logger = require('../logger');

/**
 * Starts the interval that checks for garbage rooms and removes them from Redis
 * and sends a message out to all the connected servers.
 */
async function startStaleRoomCleaner() {
  const client = new Client();
  await client.init();
  setInterval(async () => {
    try {
      logger.info('Checking for stale rooms');
      const numRemoved = await client.removeStaleRooms();
      if (numRemoved) {
        const wasOrWere = numRemoved > 1 ? 'were' : 'was';
        logger.warn(`${numRemoved} room${numRemoved > 1 ? 's' : ''} ${wasOrWere} found to be stale and ${wasOrWere} removed.`);
      }
    } catch (error) { logger.error(error); }
  }, server.staleRoomCleanerInterval);
}

module.exports = startStaleRoomCleaner;

if (!module.parent) startStaleRoomCleaner();
