
/**
 * @module constants/socketEvents.js
 * @description Contains all events that are specific to socket-to-server connections
 */

exports.ConnectionReady = 'socket:ready';
exports.CreateOrJoinRoom = 'socket:createOrJoinRoom';
exports.RoomJoined = 'socket:room:joined';
exports.RoomRejoinFailed = 'socket:room:rejoin:failed';
exports.Blip = 'socket:blip';
exports.Pulse = 'socket:pulse';
