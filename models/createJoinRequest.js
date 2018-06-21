
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;

const { DeviceType, coerce } = require('../enum');
const importSchema = require('../flatbuffer/importSchema');

const { Transport } = importSchema('Transport');

/**
 * Represents a request from a client to create or join a Neuralyzer room.
 * @class CreateJoinRequest
 */
class CreateJoinRequest {
  /**
   * Creates an instance of CreateJoinRequest.
   * @param {String} room - Room to be created or joined.
   * @param {String} username - Requested username for user.
   * @param {String} userId - ID of user joining the room.
   * @param {String} deviceType - Type of the device the user is using to connect.
   * @memberof CreateJoinRequest
   * @constructs CreateJoinRequest
   */
  constructor(room, username, userId, deviceType) {
    this.room = room;
    this.username = username;
    this.userId = userId;
    this.deviceType = coerce(DeviceType, deviceType);
  }
  /**
   * Converts an instance of CreateJoinRequest
   * to a FlatBuffer.
   * @param {Builder} builder - Flat Buffer builder.
   * @memberof CreateJoinRequest
   * @returns {Offset} Offset for use in packing Flat Buffer.
   */
  toOffset(builder) {
    if (!builder || !(builder instanceof Builder)) {
      throw new Error('Unable to create flat buffer offset for create join request because no builder was provided.');
    }
    const { JoinCreateRequest } = Transport.FlatBuffers;
    const room = builder.createString(this.room);
    const username = builder.createString(this.username);
    const userId = builder.createString(this.userId);
    const deviceType = builder.createString(this.deviceType);
    JoinCreateRequest.startJoinCreateRequest(builder);
    JoinCreateRequest.addRoom(builder, room);
    JoinCreateRequest.addName(builder, username);
    JoinCreateRequest.addUserId(builder, userId);
    JoinCreateRequest.addDeviceType(builder, deviceType);
    return JoinCreateRequest.endJoinCreateRequest(builder);
  }
  /**
   * Converts an instance of CreateJoinRequest to a Flat Buffer
   * for sending over the wire.
   * @returns {UInt8Array} Flat buffer
   * @memberof CreateJoinRequest
   */
  toFlatBuffer() {
    const builder = new Builder();
    builder.finish(this.toOffset(builder));
    return builder.asUint8Array();
  }
}

/**
 * Deserializes a Flat Buffer back into a CreateJoinRequest object.
 * @param {Byte[]} buffer - The Buffer
 * @returns {CreateJoinRequest}
 */
CreateJoinRequest.fromFlatBuffer = function fromFlatBuffer(buffer) {
  const bb = new ByteBuffer(buffer);
  const reqBuf = Transport.FlatBuffers.JoinCreateRequest.getRootAsJoinCreateRequest(bb);
  const req = new CreateJoinRequest(reqBuf.room(), reqBuf.name(), reqBuf.userId(), reqBuf.deviceType());
  return req;
};

module.exports = CreateJoinRequest;
