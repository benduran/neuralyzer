
/**
 * @module constants/channelEvents
 * @description Contains all possible messages that can be broadcasted on the
 * private Redis channel that is reserved for server-to-server communications.
 */
exports.CreateRoom = 'channel:room:created';
exports.JoinUserToRoom = 'channel:room:user:joined';
exports.LeaveUserFromRoom = 'channel:room:user:left';
exports.CloseRoom = 'channel:room:closed';
exports.RoomStateUpdate = 'channel:room:state:update';
exports.RemoveStaleRooms = 'channel:rooms:removestale';
