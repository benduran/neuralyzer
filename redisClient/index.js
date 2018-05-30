
/* https://www.npmjs.com/package/redis */
/* Library is a 1-1 mapping of Redis commands, available here: https://redis.io/commands */
const { createClient } = require('redis');

const config = require('../config');
const logger = require('../logger');
const { SocketMessage, Room } = require('../models');
const { ChannelEvents } = require('../constants');
const { SERVER_MSG_CHANNEL, ROOM_PREFIX, SOCKET_ASSIGNMENT_PREFIX, ROOM_ALIAS_PREFIX } = require('./keysAndChannels');

/**
 * Logs an info message to winston. Useful for debugging.
 * @param {String} msg - Message to log
 * @param {Boolean} includeStack - (Optional) If true, logs stack trace.
 */
function _logInfo(msg, includeStack) {
  let out = `redisClient/index.js: ${msg}`;
  if (includeStack) out += `\n${new Error().stack}`;
  logger.info(out);
}

class RedisClient {
  constructor() {
    this.pub = null;
    this.sub = null;
  }
  /**
   * Initializes pub and sub connections to the Redis server provided in the configuration file.
   */
  init() {
    return new Promise((resolve, reject) => {
      function handleError(error, rej) {
        try {
          logger.error(error);
          rej(error);
        } catch (err) { /* No-Op, promise was already resolved */ }
      }
      try {
        const redisConfig = { ...config.redis };
        if (!redisConfig.password) delete redisConfig.password;
        this.pub = createClient(redisConfig);
        this.sub = createClient(redisConfig);
        const all = [new Promise((pubResolve, pubReject) => {
          this.pub.on('error', err => handleError(err, pubReject));
          this.pub.on('ready', pubResolve);
        }), new Promise((subResolve, subReject) => {
          this.sub.on('error', err => handleError(err, subReject));
          this.sub.on('ready', subResolve);
        })];
        let connectionTimeout = setTimeout(() => {
          connectionTimeout = clearTimeout(connectionTimeout);
          reject(new Error(`Unable to connect to "${config.redis.host}:${config.redis.port}". Connection timed out.`));
        }, 15000);
        Promise.all(all).then(() => {
          if (connectionTimeout) connectionTimeout = clearTimeout(connectionTimeout);
          resolve();
        }).catch(reject);
      } catch (error) {
        logger.error(error);
        throw error;
      }
    });
  }
  /**
   * Closes all connections to the Redis server in the config file.
   */
  async close() {
    const all = [];
    if (this.pub) {
      all.push(new Promise((resolve, reject) => {
        this.pub.quit((error) => {
          if (error) return reject(error);
          return resolve();
        });
      }));
    }
    if (this.sub) {
      all.push(new Promise((resolve, reject) => {
        this.sub.quit((error) => {
          if (error) return reject(error);
          return resolve();
        });
      }));
    }
    await Promise.all(all);
  }
  /**
   * Gets the formatted Redis key for a socket connection's room assignment
   * @param {String} sid - UUID for socket connection
   * @return {String} Formatted redis key for looking up socket connection assignments
   */
  getRedisSocketAssignment(sid) {
    return `${SOCKET_ASSIGNMENT_PREFIX}${sid}`;
  }
  /**
   * Gets the formatted Redis key for a room that's stored in Redis
   * @param {String} roomId - UUID of the room
   * @return {String} Formatted redis key for looking up a room in progress
   */
  getRedisRoomKey(roomId) {
    return `${ROOM_PREFIX}${roomId}`;
  }
  /**
   * Gets the alias key for a room that's stored in Redis.
   * @param {String} roomname - Name of the room
   * @return {String} Formatted Redis key for looking up the actual ID-based Redis key.
   */
  getRedisRoomAliasKey(roomname) {
    return `${ROOM_ALIAS_PREFIX}${roomname}`;
  }
  /**
   * Broadcasts message to all servers that a user has left a specific room.
   * @param {Room} room - room that the participant left from. Room should be the updated representation.
   * @param {Participant} participant - Participant that left the room
   */
  leaveUserFromRoom(room, participant) {
    _logInfo(`Leaving ${participant.name} from ${room.name}`);
    return new Promise((resolve, reject) => {
      if (!room) return reject(new Error('No room was provided when publishLeaveUserFromRoom called.'));
      if (!participant) return reject(new Error('No participant was provided when publishLeaveUserFromRoom called.'));
      return this.pub.set(this.getRedisRoomKey(room.id), JSON.stringify(room), (roomSetError) => {
        if (roomSetError) return reject(roomSetError);
        return this.pub.publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
          data: { roomId: room.id, participant },
          msgType: ChannelEvents.LeaveUserFromRoom,
        })), (error) => {
          if (error) return reject(error);
          return resolve(this);
        });
      });
    });
  }
  /**
   * Broadcasts message to all servers that a user is joining a specific room.
   * @param {Room} room - Room that the participant is joining. Room should be the updated representation.
   * @param {Participant} participant - Participant that is joining the room.
   * @param {Boolean} [rejoin=false] - If true, servers that receive this message will "not"
   * append the participant to their room state, as they should already exist locally in the server's state.
   */
  joinUserToRoom(room, participant, rejoin = false) {
    _logInfo(`Joining ${participant.name} to ${room.name}`);
    return new Promise((resolve, reject) => {
      if (!room) return reject(new Error('Unable to send join user to room channel message because no room was provided.'));
      if (!participant) return reject(new Error('Unable to send join user to room channel message because no participant was provided.'));
      return this.pub.set(this.getRedisRoomKey(room.id), JSON.stringify(room), (roomSetError) => {
        if (roomSetError) return reject(roomSetError);
        return this.pub.publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
          msgType: ChannelEvents.JoinUserToRoom,
          data: { roomId: room.id, participant, rejoin },
        })), (error) => {
          if (error) return reject(error);
          return resolve(this);
        });
      });
    });
  }
  /**
   * Checks whether or not a room has already been defined and exists within Redis.
   * Uses the room name to check the alias of the room.
   * @param {String} roomName - Name of the room
   */
  checkRoomExists(roomName) {
    _logInfo(`Checking if ${roomName} exists in redis`);
    return new Promise((resolve, reject) => {
      if (!roomName) return reject(new Error('Unable to check if room exists because no roomName was provided.'));
      return this.pub.exists(this.getRedisRoomAliasKey(roomName), (error, exists) => {
        if (error) return reject(error);
        return resolve(exists);
      });
    });
  }
  /**
   * Checks whether or not this room already exists in redis.
   * Creates the room if it doesn't exist, and publishes an update message to all servers.
   * @param {Room} room - Room to create.
   */
  createRoom(room) {
    _logInfo(`Creating new room ${room.name}`);
    return new Promise(async (resolve, reject) => {
      if (!room) return reject(new Error('Unable to create room in redis because no room was provided.'));
      const key = this.getRedisRoomKey(room.id);
      const exists = await this.checkRoomExists(room.name);
      if (exists) return reject(new Error('Unable to create room in redis because it already exists.'));
      return this.pub
        .multi()
        .set(key, JSON.stringify(room))
        .set(this.getRedisRoomAliasKey(room.name), key)
        .publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
          msgType: ChannelEvents.CreateRoom,
          data: room,
        })))
        .exec((err) => {
          if (err) return reject(err);
          return resolve(key);
        });
    });
  }
  /**
   * Updates a room in redis and publishes an update message to all servers.
   * @param {Room} room - Updated room to set in Redis cache
   * @param {String} sid - UUID for socket connection that caused the update
   * @param {StateUpdate} update - Room update object that describes the transforms that will happen to the room state object.
   * @param {String} serverid - UUID of the server that received the request to update room state.
   */
  roomStateUpdate(room, sid, update, serverid) {
    return new Promise((resolve, reject) => {
      if (!room) return reject(new Error('Unable to update room because no room was provided.'));
      if (!sid) return reject(new Error('Unable to update room without a socket sid because we need to know who updated the room!'));
      if (!update) return reject(new Error('Unable to send room update message over the pub / sub channel without a room update object.'));
      return this.pub.set(this.getRedisRoomKey(room.id), JSON.stringify(room), (error) => {
        if (error) return reject(error);
        return this.pub.publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
          msgType: ChannelEvents.RoomStateUpdate,
          data: { room, sid, update, serverid },
        })), (pubError) => {
          if (pubError) return reject(pubError);
          return resolve(this);
        });
      });
    });
  }
  /**
   * Removes a room from redis cache and publishes an update to all connected servers.
   * @param {Room} room - Room to remove
   */
  removeRoom(room) {
    _logInfo(`Removing room ${room.name} from Redis.`);
    return new Promise((resolve, reject) => {
      if (!room) return reject(new Error('Unable to remove room because no room was provided to remove.'));
      return this.pub.del(this.getRedisRoomKey(room.id), (delKeyError) => {
        if (delKeyError) return reject(delKeyError);
        return this.pub.del(this.getRedisRoomAliasKey(room.name), (delAliasError) => {
          if (delAliasError) return reject(delAliasError);
          return this.pub.publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
            data: room,
            msgType: ChannelEvents.CloseRoom,
          })), (pubError) => {
            if (pubError) return reject(pubError);
            return resolve(this);
          });
        });
      });
    });
  }
  /**
   * Gets a room's details from Redis cache.
   * @param {String} roomname
   * @return {Object} The room in the redis cache
   */
  getRoom(roomname) {
    _logInfo(`Getting room ${roomname} from Redis.`);
    return new Promise((resolve, reject) => {
      if (!roomname) return reject(new Error('Unable to get room because no roomname was provided.'));
      return this.pub.get(this.getRedisRoomAliasKey(roomname), (error, aliasKey) => {
        if (error) return reject(error);
        if (!roomname) return resolve(null);
        return this.pub.get(aliasKey, (getRoomError, roomStr) => {
          try {
            return resolve(roomStr ? JSON.parse(roomStr) : null);
          } catch (parseError) { return reject(parseError); }
        });
      });
    });
  }
  /**
   * Creates a unique redis key for the socket. Value of this key is the room key to the room the socket is connected to.
   * @param {Room} room - Room socket is going to be assigned to
   * @param {String} sid - UUID for socket connection
   */
  assignSocketIdToRoom(room, sid) {
    _logInfo(`Assigning socket ${sid} to ${room.name}`);
    return new Promise((resolve, reject) => {
      if (!room) return reject(new Error('Unable to assign socket id to room because no room was provided.'));
      if (!sid) return reject(new Error('Unable to assign socket id to room because no sid was provided.'));
      return this.pub.set(this.getRedisSocketAssignment(sid), this.getRedisRoomKey(room.id), (error) => {
        if (error) return reject(error);
        return resolve(this);
      });
    });
  }
  /**
   * Removes a socket connection's assignment from redis.
   * @param {String} sid - UUID for socket connection to be removed
   */
  removeSocketAssignment(sid) {
    _logInfo(`Removing socket ${sid} assignment from Redis.`);
    return new Promise((resolve, reject) => {
      if (!sid) return reject(new Error('Cannot remove socket assignment from redis because no sid was provided.'));
      return this.pub.del(this.getRedisSocketAssignment(sid), (error) => {
        if (error) return reject(error);
        return resolve(this);
      });
    });
  }
  /**
   * Gets a socket connection's room assignment.
   * @param {String} sid - UUID for the socket connection
   * @return {String} Redis key for the room the socket's assigned to, or null if not assigned.
   */
  getSocketAssignment(sid) {
    // _logInfo(`Getting socket ${sid} assignment`);
    return new Promise((resolve, reject) => {
      if (!sid) return reject(new Error('Unable to get socket assignment because no sid was provided.'));
      return this.pub.get(this.getRedisSocketAssignment(sid), (error, socketAssignment) => {
        if (error) return reject(error);
        return resolve(socketAssignment);
      });
    });
  }
  /**
   * Subscribes a function to all messages that come through the pub / sub server message channel.
   * @param {Function} onMessage - Callback to be executed when a message comes through over the server message channel.
   */
  subscribeToServerChannel(onMessage) {
    return new Promise((resolve, reject) => {
      if (typeof onMessage !== 'function') return reject(new Error('Unable to subscribe to server channel without an onMessage callback.'));
      this.sub.on('message', (channel, msg) => {
        if (channel === SERVER_MSG_CHANNEL) onMessage(msg);
      });
      return this.sub.subscribe(SERVER_MSG_CHANNEL, (error) => {
        if (error) return reject(error);
        return resolve(this);
      });
    });
  }
  /**
   * Cancels all subscriptions over the sub redis client for the server message channel.
   */
  cancelServerSubscriptions() {
    return new Promise((resolve, reject) => {
      this.sub.unsubscribe(SERVER_MSG_CHANNEL, (error) => {
        if (error) return reject(error);
        return resolve(this);
      });
    });
  }
  /**
   * Performs a recursive scan operation against Redis and returns the list of all
   * current room keys in Redis.
   * @param {Number} [cursor=0] - Current cursor to continue scan operation. Defaults to 0.
   * @return {String[]} All room keys, not room aliases.
   */
  getAllRoomKeys(cursor = 0) {
    return new Promise((resolve, reject) => {
      this.pub.scan(cursor, (scanError, [strNextCursor, results]) => {
        if (scanError) {
          reject(scanError);
        } else {
          const nextCursor = parseInt(strNextCursor, 10);
          if (nextCursor) {
            this
              .getAllRoomKeys(nextCursor)
              .then(nextResults => resolve(results.concat(nextResults).filter(key => key.startsWith(ROOM_PREFIX))))
              .catch(reject);
          } else resolve(results.filter(key => key.startsWith(ROOM_PREFIX)));
        }
      });
    });
  }
  /**
   * Performs a recursive scan operation against Redis and returns the list
   * of all socket assignment keys for Web Sockets that are actvely connected
   * to one of the Neuralyzer servers.
   * @param {number} [cursor=0] - Current cursor to continue Redis scan operation. Defaults to 0.
   * @memberof RedisClient
   * @returns {String[]} All socket assignment keys
   */
  getAllSocketAssignments(cursor = 0) {
    return new Promise((resolve, reject) => {
      this.pub.scan(cursor, (scanError, [strNextCursor, results]) => {
        if (scanError) return reject(scanError);
        const nextCursor = parseInt(strNextCursor, 10);
        if (!nextCursor) return resolve(results.filter(r => r.startsWith(SOCKET_ASSIGNMENT_PREFIX)));
        return this
          .getAllSocketAssignments(nextCursor)
          .then(nextResults => results.concat(nextResults).filter(r => r.startsWith(SOCKET_ASSIGNMENT_PREFIX)))
          .catch(reject);
      });
    });
  }
  /**
   * Gets all room keys in Redis and checks which ones have zero participants in them.
   * All rooms that match the criteria are removed from Redis.
   * @memberof RedisClient
   * @returns {Number} Number of rooms that were cleaned out of Redis.
   */
  async removeStaleRooms() {
    const allRoomKeys = await this.getAllRoomKeys();
    const allRooms = (await Promise.all(allRoomKeys.map(key => new Promise((resolve, reject) => {
      this.pub.get(key, (error, roomStr) => {
        if (error) return reject(error);
        return resolve(new Room(JSON.parse(roomStr)));
      });
    }))));
    const allSockets = await Promise.all((await this.getAllSocketAssignments()).map(skey => new Promise((resolve, reject) => {
      this.pub.get(skey, (getError, roomKey) => {
        if (getError) return reject(getError);
        return resolve({ socketKey: skey, socketId: skey.replace(SOCKET_ASSIGNMENT_PREFIX, ''), roomId: roomKey.replace(ROOM_PREFIX, '') });
      });
    })));
    // We need to remove all rooms that either have no participants
    // OR have no active connections for the participants that are in them
    const toRemove = [];
    allRooms.forEach((r) => {
      const shouldRemove = !r.participants.length || !allSockets.some(({ roomId }) => roomId === r.id);
      if (shouldRemove) toRemove.push(r);
    });
    // We don't care about errors, just try to delete everything
    await Promise.all(toRemove.map(r => new Promise((resolve) => {
      this.pub.del(this.getRedisRoomKey(r.id), () => this.pub.del(this.getRedisRoomAliasKey(r.name), resolve));
    })));
    // Send messages out over the pub / sub channel about the rooms that are being removed
    this.pub.publish(SERVER_MSG_CHANNEL, JSON.stringify(new SocketMessage({
      msgType: ChannelEvents.RemoveStaleRooms,
      data: toRemove.map(r => r.id),
    })));
    return toRemove.length;
  }
}

module.exports = RedisClient;
