
const uuid = require('uuid/v4');

const config = require('../config');
const { RoomState, Server } = require('../actionTypes');
const Client = require('../redisClient');
const { Room, RoomState: RoomStateModel, SocketMessage, Participant, StateUpdate } = require('../models');
const logger = require('../logger');
const { ChannelEvents, RoomEvents, SocketEvents } = require('../constants');
const { ROOM_PREFIX } = require('../redisClient/keysAndChannels');
const tickActions = require('./tickActions');

/**
 * Gets a socket's sid room that they're assigned to.
 * @param {String} roomAssignment - Socket sid room assignment Redis key.
 * @param {Object} roomState - Current Redux room state.
 * @return {Room} Room socket sid is assigned to
 */
function _getRoomByRoomAssignment(roomAssignment, roomState) {
  const roomIdAssignment = roomAssignment.replace(ROOM_PREFIX, '');
  for (const roomId in roomState.rooms) {
    if (roomId === roomIdAssignment) return roomState.rooms[roomId];
  }
  return null;
}

/**
 * Broadcasts a message to all clients that are in a specific room
 * and are connected to this server.
 * @param {String} roomId - ID of room
 * @param {String|SocketMessage} msg - Message to broadcast to room clients
 * @param {String} [excludeSid=null] - (Optional) Socket ID to exclude from the broadcast
 */
function _broadcastToRoom(roomId, msg, excludeSid = null) {
  return (dispatch, getState) => {
    const { roomState, server } = getState();
    const roomMatch = roomState.rooms[roomId];
    if (roomMatch) {
      for (const client of server.clients) {
        const clientOk = client.readyState === client.OPEN && !client.stale && client.sid !== excludeSid;
        if (clientOk && roomMatch.participants.some(p => p.sid === client.sid)) {
          client.send(typeof msg === 'string' ? msg : msg.toWire());
        }
      }
    }
  };
}

/**
 * Sends a message to a specific socket if this socket is connected to this server.
 * @param {String} sid - Socket ID of socket
 * @param {SocketMessage} msg - Message to send
 */
function _broadcastToSocket(sid, msg) {
  return (dispatch, getState) => {
    const { server } = getState();
    for (const client of server.clients) {
      const clientOk = client.readyState === client.OPEN && client.sid === sid && !client.stale;
      if (clientOk) {
        client.send(typeof msg === 'string' ? msg : msg.toWire());
        break;
      }
    }
  };
}

/**
 * Assigns the socketID key to the room it is currently connected to.
 * Doesn't need to broadcast out to everyone. Only needs to store in Redis for if / when the connections is broken,
 * or the user actually leaves. Doesn't trigger a redux state update.
 * @param {String} roomName - Name of room.
 * @param {String} sid - Unique ID for a specific socket connection.
 */
function assignSocketIdToRoom(roomName, sid) {
  return async (dispatch, getState) => {
    try {
      const { client, rooms } = getState().roomState;
      await client.assignSocketIdToRoom(Object.values(rooms).find(r => r.name === roomName), sid);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
}

/**
 * Removes room from local state, but not before telling all
 * connected clients to this room that their socket connections need to be closed.
 * @param {Room} room - Room that's being closed.
 */
function onRoomClosed(room) {
  return (dispatch, getState) => {
    const { roomState, server } = getState();
    const localRoom = roomState.rooms[room.id];
    if (localRoom) {
      const clientsToClose = [];
      for (const client of server.clients) {
        if (localRoom.participants.some(p => p.sid === client.sid)) clientsToClose.push(client);
      }
      clientsToClose.forEach(c => c.close());
      dispatch({ type: RoomState.OnRoomClosed, roomId: room.id });
    }
  };
}

/**
 * Closes a room by blanking out its information in Redis.
 * Notifies the sub channel that the room has been closed.
 * All servers subscribed to this message will then remove the room from their local state,
 * but not before closing the websocket connections to all connected clients for this room.
 * @param {String} roomId - ID of the room that is being closed.
 */
function closeRoom(roomId) {
  return async (dispatch, getState) => {
    try {
      const { client, rooms } = getState().roomState;
      const room = rooms[roomId];
      if (room) {
        dispatch(onRoomClosed(room));
        await client.removeRoom(room);
      }
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
}

/**
 * Merges in pendingUpdate changes in the provided room object against what is currently existing in the
 * server's local copy of the state. Can only be triggered
 * by a broadcasted message to the SERVER_MSG_CHANNEL.
 * @param {Object} args
 * @param {Room} args.room - Room that has been updated. Use this to update local state.
 * @param {RoomUpdate} args.update - RoomUpdate object that describes the update to the room. Will be broadcasted to everyone.
 * @param {String} args.serverid - ID of the server that sent the room state update.
 */
function onRoomStateUpdate({ room, update, serverid }) {
  // room, sid, update, serverid
  return (dispatch, getState) => new Promise((resolve, reject) => {
    try {
      if (serverid !== config.server.id) {
        const { roomState } = getState();
        const roomToUpdate = roomState.rooms[room.id];
        if (roomToUpdate) {
          // We'll use the local state for the room,
          // in case some state changes happened before this one.
          dispatch({ type: RoomState.OnRoomStateUpdate, room: roomToUpdate, update: new StateUpdate(update) });
          // We get the room as its new state rests in the Redux state.
          // If we don't already have an update to send, then add an event function to the queue
          dispatch(tickActions.enqueue(() => {
            const { roomState: { roomStateUpdates } } = getState();
            if (roomStateUpdates[room.id]) {
              // Only broadcast if there is an update to send out for a given room
              const updateToSend = roomStateUpdates[room.id];
              if (updateToSend) {
                dispatch({ type: RoomState.ClearUpdate, roomId: room.id });
                dispatch(_broadcastToRoom(room.id, new SocketMessage({ msgType: RoomEvents.RoomStateUpdate, data: updateToSend })));
              }
            }
          }));
        }
        resolve();
      }
    } catch (error) { reject(error); }
  });
}

/**
 * Checks if room exists, and broadcasts all messages out over the private Server Redis channel
 * so that all other server can apply the update deltas to their local copy of the room state.
 * @param {String} sid - Socket connection identifier. Will be used to see what room this person is in.
 * @param {StateUpdate} update - Update object that contains only the properties that will be updated in room state
 * @param {String} [roomId=null] - (Optional) If set, uses this roomID to determine in which room the state is updated.
 * Otherwise, the sid is used for determining which room is being updated.
 */
function updateRoomState(sid, update, roomId = null) {
  return async (dispatch, getState) => {
    const { client, rooms } = getState().roomState;
    const roomAssignment = await client.getSocketAssignment(sid);
    const room = roomId ? rooms[roomId] : _getRoomByRoomAssignment(roomAssignment, getState().roomState);
    if (room) {
      const participant = room.participants.find(p => p.sid === sid);
      if (Array.isArray(update.create)) {
        update.create.forEach((o) => { o.owner = participant.id; });
      }
      const newState = new RoomStateModel(room.state.props, room.state.objects).applyStateUpdate(update);
      const out = new SocketMessage({
        msgType: ChannelEvents.RoomStateUpdate,
        data: { room: new Room({ ...room, state: newState }), sid, update },
      });
      dispatch(onRoomStateUpdate(out.data));
      // We're going to wait until redis says we can update the room.
      // This function will fire as private redis channel upate state event.
      // This is fire-and-forget. Other servers will pick it up, and we don't really care
      // about waiting for this operation to run to completion before continuing
      client.roomStateUpdate(new Room({ ...room, state: newState }), sid, update, config.server.id);
    }
  };
}

/**
 * Removes a participant from a room in the local redux state.
 * Can only be triggered by a broadcasted message to the SERVER_MSG_CHANNEL.
 * Only removes the participant if their rooms exists and their sid is contained in the connection pool for the room.
 * @param {Object} data
 * @param {String} data.roomId - ID of room that is being left
 * @param {Participant} data.participant - Participant that is leaving the room.
 */
function onLeaveUserFromRoom(data) {
  return async (dispatch, getState) => {
    let room = getState().roomState.rooms[data.roomId];
    const participant = room ? room.participants.find(p => p.id === data.participant.id) : null;
    if (room && participant) {
      // If there are no more participants in the room, nuke it from orbit
      dispatch({ type: RoomState.OnLeaveUserFromRoom, room, participant: data.participant });
      room = getState().roomState.rooms[data.roomId];
      if (!room.participants.length) {
        return dispatch(closeRoom(room.id));
      }
      dispatch(tickActions.enqueue(() => dispatch(_broadcastToRoom(data.roomId, new SocketMessage({
        msgType: RoomEvents.OnLeaveUserFromRoom,
        data: participant.name,
      }), data.participant.sid))));
    }
    return Promise.resolve();
  };
}

/**
 * Checks if this socket ID is in a room that still exists in memory.
 * If so, broadcasts all required messages to Redis.
 * @param {String} sid - Socket ID for the user that is leaving the room
 */
function leaveUserFromRoom(sid) {
  return async (dispatch, getState) => {
    const { client } = getState().roomState;
    const roomAssignment = await client.getSocketAssignment(sid);
    if (roomAssignment) {
      // Get roomstate again, in case any updates came in while we were querying for our room
      let room = _getRoomByRoomAssignment(roomAssignment, getState().roomState);
      if (room) {
        const participant = room.participants.find(p => p.sid === sid);
        if (participant) {
          // Update the room in Redis first, THEN run the onLeaveUser logic to prevent a delete room call
          // from being overwritten by a room leave update
          await client.leaveUserFromRoom(room, participant);
          await dispatch(onLeaveUserFromRoom({ roomId: room.id, participant }));
          room = getState().roomState.rooms[room.id];
          await client.removeSocketAssignment(sid);
          if (room) {
            // Remove all disposable objects from the room state that applied to this user
            await dispatch(updateRoomState(sid, new StateUpdate({
              delete: Object.values(room.state.objects).filter(o => o.owner === participant.id && o.disposable).map(o => o.id),
            }), room.id));
          }
        }
      }
    }
  };
}

/**
 * Adds a participant to the room in the local copy of redux state.
 * Can only be triggered by a broadcasted message toe the SERVER_MSG_CHANNEL.
 * Only adds the participant if they don't already exist in the room with the incoming sid (socket id).
 * @param {Object} data
 * @param {Participant} data.participant - Participant that's joining the room
 * @param {String|Number} data.roomId - ID of the room that the participant is joining
 * @param {Boolean} data.rejoin - If true, will let the user join the room even if they're already "in" the room's state.
 */
function onUserJoinedRoom(data) {
  return (dispatch, getState) => {
    const { rooms } = getState().roomState;
    const room = rooms[data.roomId];
    if ((room && data.rejoin) || !room.participants.some(p => p.sid === data.participant.sid)) {
      logger.info(`User with sid "${data.participant.sid}" is joining room "${room.id}:${room.name}"`);
      dispatch({
        type: RoomState.OnUserJoinedRoom,
        participant: data.participant,
        rejoin: data.rejoin,
        room,
      });
      dispatch(tickActions.enqueue(() => {
        dispatch(_broadcastToRoom(room.id, new SocketMessage({
          msgType: RoomEvents.OnUserJoinedRoom,
          data: data.participant.name,
        }), data.participant.sid));
        dispatch(_broadcastToSocket(data.participant.sid, new SocketMessage({
          msgType: SocketEvents.RoomJoined,
          data: new Room(room).asRoomJoin(),
        })));
      }));
    }
  };
}

/**
 * Checks if sid for user is already in the room. If not, sends message out that user needs to be added.
 * Broadcasts all required messages out over the Redis channel.
 * @param {String} roomName - Name of room user is joining.
 * @param {Participant} participant - Person joining room.
 * @param {Boolean} [rejoin=false] - If true, will attempt to join the room and "not" create a new participant
 * in the room's state. Defaults to "false," which is a clean create or join.
 */
function joinUserToRoom(roomName, participant, rejoin = false) {
  return async (dispatch, getState) => {
    const { client } = getState().roomState;
    const room = await client.getRoom(roomName);
    if (!room) throw new Error(`Unable to join user to room "${roomName}" because it does not exist in Redis cache.`);
    const participantExistsInRoom = room.participants.some(p => p.sid === participant.sid);
    if (participantExistsInRoom && !rejoin) {
      throw new Error(`User "${participant.name}" cannot join room "${roomName}" because they are already connected to this room.`);
    }
    if (!participantExistsInRoom) {
      // They don't exist in the room, so explicilty add them.
      participant = new Participant(participant);
      room.participants = room.participants.concat([participant]);
    }
    await client.joinUserToRoom(room, participant, rejoin);
    dispatch(onUserJoinedRoom({ roomId: room.id, participant, rejoin }));
  };
}

/**
 * Adds room to local copy of Redux state. Can only be triggered
 * by a broadcasted message to the SERVER_MSG_CHANNEL.
 * Only creates the room in memory if it doesn't already exist.
 * @param {Room} room - Room to be created in the redux store.
 */
function onRoomCreated(room) {
  return (dispatch, getState) => {
    const { rooms } = getState().roomState;
    if (!rooms[room.name]) dispatch({ type: RoomState.OnRoomCreated, room });
  };
}

/**
 * Checks if room already exists, and creates if it doesn't. If room already exists, room is joined instead.
 * Broadcasts all required messages out over the Redis channel.
 * @param {String} roomName - Name of room to create
 * @param {Participant} participant - Participant that will be joining the room.
 * @return {Room} Room that was just created.
 */
function createOrJoinRoom(roomName, participant) {
  logger.info(`${participant.name} is trying to create or join a room.`);
  return async (dispatch, getState) => {
    const { client } = getState().roomState;
    async function createNew() {
      const newRoom = new Room({ name: roomName, id: uuid() });
      dispatch(onRoomCreated(newRoom)); // Don't push the room to Redis until local server has it in memory
      await client.createRoom(newRoom);
      return newRoom;
    }
    try {
      let roomToJoin = null;
      logger.info(`Checking if ${roomName} exists.`);
      const exists = await client.checkRoomExists(roomName);
      let roomCreated = false;
      if (exists) {
        // It is totally possible that REDIS reports the room has been created
        // but it hasn't been pushed to the server yet.
        logger.info(`${roomName} exists in Redis. Checking to see if the room is also in local state.`);
        // It exists, so it should be in our local state. Join that instead.
        const { rooms } = getState().roomState;
        for (const roomId in rooms) {
          if (rooms[roomId].name === roomName) {
            logger.info(`${roomName} was found in local state.`);
            roomToJoin = rooms[roomId];
            break;
          }
        }
      }
      if (!roomToJoin) {
        logger.info(`${roomName} was not found. Creating new.`);
        roomToJoin = await createNew();
        roomCreated = true;
      }
      dispatch(tickActions.enqueue(async () => {
      // Send message to everyone...which should only be the person that created the room
        await dispatch(joinUserToRoom(roomName, participant));
        if (roomCreated) {
          logger.info(`Broadcasting creation of room "${roomName}"`);
          dispatch(_broadcastToRoom(roomToJoin.id, new SocketMessage({
            msgType: RoomEvents.RoomCreated,
            data: roomToJoin.id,
          })));
        }
        return roomToJoin;
      }));
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
}

/**
 * Attempts to reconnect a socket with a given "sid" to the room they were in before the disconnect happened.
 * If they weren't in a room before, or we cannot find one for them to join,
 * and error message will be sent back to the client.
 * @param {WebSocket} socket - Socket of user trying to reconnect to Neuralyzer.
 * @param {WebSocket} socketToExpire - Socket that is becoming stale and will need expiring.
 */
function attemptReconnect(socket, socketToExpire) {
  return async (dispatch, getState) => {
    logger.info(`Attempting to reconnect socket with id ${socket.sid} to room...`);
    try {
      const { client } = getState().roomState;
      // Check to see if this sid has an assignment that wasn't blanked out yet.
      const assignment = await client.getSocketAssignment(socket.sid);
      if (!assignment) throw new Error('Socket was not assigned to room anymore and thus could not rejoin.');
      const room = _getRoomByRoomAssignment(assignment, getState().roomState);
      if (!room) throw new Error(`Socket room assignment ${assignment} was not found for socket to rejoin.`);
      if (room) {
        // Okay, this socket was, in fact, in a room when they disconnected.
        // Let's try to get the Participant details from the room as it exists in Redis.
        const participant = room.participants.find(p => p.sid === socket.sid);
        if (!participant) throw new Error(`Participant was not found in room ${room.name} and thus socket could not rejoin.`);
        // Alright, we've made it this far! Congrats!
        // We're going to let you back into the cool club.
        logger.info(`Socket id ${socket.sid} is assigned to room ${room.name} for participant${participant.name}.`);
        dispatch({ type: Server.StaleifyConnection, socket: socketToExpire });
        await dispatch(joinUserToRoom(room.name, participant, true));
        return socketToExpire; // This socket was probably mutated in the serverReducer.
        // As such, it should have a new sid, so we can expire it one layer up in the server actions
      }
    } catch (error) {
      // Pipe out a specific error message directly to the socket that attempted to rejoin.
      logger.error(`Socket sid "${socket.sid}" was unable to rejoin room they used to be in.`);
      logger.error(error);
      _broadcastToSocket(socket.sid, new SocketMessage({
        msgType: SocketEvents.RoomRejoinFailed,
        data: { error: error.message },
      }));
    }
    return null;
  };
}

/**
 * Removes all rooms in this local server's state
 * whose IDs match what was sent in.
 * @param {String[]} roomIds - Array of IDs of rooms to remove
 */
function onRemoveStaleRooms(roomIds) {
  return { type: RoomState.RemoveStaleRooms, roomIds };
}

/**
 * Handles only messages sent between servers about the state of the Redis store.
 * @param {String} msg - Message received from the Redis channel.
 */
function handleServerMessage(msg) {
  return (dispatch) => {
    // These will ALWAYS be strings
    const parsed = JSON.parse(msg);
    switch (parsed.msgType) {
      case ChannelEvents.CreateRoom:
        return dispatch(onRoomCreated(parsed.data));
      case ChannelEvents.JoinUserToRoom:
        return dispatch(onUserJoinedRoom(parsed.data));
      case ChannelEvents.LeaveUserFromRoom:
        return dispatch(onLeaveUserFromRoom(parsed.data));
      case ChannelEvents.CloseRoom:
        return dispatch(onRoomClosed(parsed.data));
      case ChannelEvents.RoomStateUpdate:
        return dispatch(onRoomStateUpdate(parsed.data));
      case ChannelEvents.RemoveStaleRooms:
        return dispatch(onRemoveStaleRooms(parsed.data));
      default:
        return null;
    }
  };
}

/**
 * Sets up the server's redis client pub / sub subscriptions over the private message channel.
 */
function setupServerSubscriptions() {
  return async (dispatch) => {
    try {
      const client = new Client();
      await client.init();
      // Save the client to the app state for shared access
      dispatch({ type: RoomState.InitRedis, client });
      // Only mark the setup subscriptions as resolved if we successfully subscribed to the server messages channel
      await client.subscribeToServerChannel(msg => dispatch(handleServerMessage(msg)));
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
}

/**
 * Cancels all Redis Subscriptions, removes all sub client handlers, and nulls out the Redis client
 * in the local Redux state.
 */
function cancelServerSubscriptions() {
  return async (dispatch, getState) => {
    const { client } = getState().roomState;
    if (client) {
      await client.cancelServerSubscriptions();
    }
  };
}

function synchronizeWithRedis() {
  return async (dispatch, getState) => {
    try {
      const { server, roomState } = getState();
      if (!roomState.client) throw new Error('Unable to synchronize with redis because redis client has not been initialized');
      if (server) throw new Error('Unable to synchronize with redis because the web socket server is already listening for connections');
      const allKeys = await roomState.client.getAllRoomKeys();
      const redisRooms = await Promise.all(allKeys.map(key => new Promise((roomResolve, roomReject) => {
        roomState.client.pub.get(key, (getError, strRoom) => {
          if (getError) return roomReject(getError);
          return roomResolve(JSON.parse(strRoom));
        });
      })));
      redisRooms.forEach(room => dispatch({ type: RoomState.OnRoomCreated, room }));
    } catch (error) { logger.error(error); }
  };
}

exports.setupServerSubscriptions = setupServerSubscriptions;
exports.cancelServerSubscriptions = cancelServerSubscriptions;
exports.handleServerMessage = handleServerMessage;
exports.createOrJoinRoom = createOrJoinRoom;
exports.joinUserToRoom = joinUserToRoom;
exports.assignSocketIdToRoom = assignSocketIdToRoom;
exports.leaveUserFromRoom = leaveUserFromRoom;
exports.updateRoomState = updateRoomState;
exports.synchronizeWithRedis = synchronizeWithRedis;
exports.attemptReconnect = attemptReconnect;
exports.closeRoom = closeRoom;
