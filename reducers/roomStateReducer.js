
const { RoomState } = require('../actionTypes');
const { Room: RoomModel, RoomState: RoomStateModel } = require('../models');

const defaultState = {
  roomStateUpdates: {},
  rooms: {},
  client: null,
};

function roomStateReducer(state = defaultState, action) {
  switch (action.type) {
    case RoomState.InitRedis:
      return { ...state, client: action.client };
    case RoomState.CancelServerSubscriptions:
      return { ...state, client: null };
    case RoomState.OnRoomCreated:
      return { ...state,
        rooms: {
          ...state.rooms,
          ...{ [action.room.id]: action.room },
        },
      };
    case RoomState.OnUserJoinedRoom:
      // If user is marked as a rejoin, just return the state as-is.
      // Otherwise, user is considered new and should be appended to the room.
      return action.rejoin ? state : {
        ...state,
        rooms: {
          ...state.rooms,
          ...{
            [action.room.id]: {
              ...state.rooms[action.room.id],
              participants: state.rooms[action.room.id].participants.concat([action.participant]),
            },
          },
        },
      };
    case RoomState.OnLeaveUserFromRoom:
      return {
        ...state,
        rooms: {
          ...state.rooms,
          ...{
            [action.room.id]: {
              ...state.rooms[action.room.id],
              participants: state.rooms[action.room.id].participants.filter(p => p.sid !== action.participant.sid),
            },
          },
        },
      };
    case RoomState.OnRoomClosed:
      return {
        ...state,
        rooms: Object.keys(state.rooms).filter(roomId => roomId !== action.roomId).reduce((prev, roomId) => {
          prev[roomId] = state.rooms[roomId];
          return prev;
        }, {}),
      };
    case RoomState.OnRoomStateUpdate:
      return {
        ...state,
        roomStateUpdates: {
          ...state.roomStateUpdates,
          [action.room.id]: action.update.merge(state.roomStateUpdates[action.room.id]),
        },
        rooms: {
          ...state.rooms,
          [action.room.id]: new RoomModel({
            ...state.rooms[action.room.id],
            state: new RoomStateModel(
              state.rooms[action.room.id].state.props,
              state.rooms[action.room.id].state.objects,
            ).applyStateUpdate(action.update),
          }),
        },
      };
    case RoomState.ClearUpdate:
      return {
        ...state,
        roomStateUpdates: Object.keys(state.roomStateUpdates).filter(rid => rid !== action.roomId).reduce((prev, rid) => {
          prev[rid] = state.roomStateUpdates[rid];
          return prev;
        }, {}),
      };
    case RoomState.RemoveStaleRooms:
      return {
        ...state,
        roomStateUpdates: Object.values(state.roomStateUpdates).filter(rid => !action.roomIds.includes(rid)).reduce((prev, rid) => {
          prev[rid] = state.roomStateUpdates[rid];
          return prev;
        }, {}),
        rooms: Object.values(state.rooms).filter(r => !action.roomIds.includes(r.id)).reduce((prev, r) => {
          prev[r.id] = state.rooms[r.id];
          return prev;
        }, {}),
      };
    default:
      return state;
  }
}

module.exports = roomStateReducer;
