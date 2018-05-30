
const uuid = require('uuid/v4');
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;

const { DeviceType, coerce } = require('../enum');
const { Transport } = require('../flatbuffer/Participant_generated').Neuralyzer;

/**
 * @class Participant
 * @description Represents a user contained in a room
 */
class Participant {
  /**
   * @constructs Participant
   * @param {Object} args
   * @param {String} args.name - Username for the user
   * @param {DeviceType} args.device - Device type the user has used to connect to the room.
   * @param {String|Number} args.id - User's ID.
   * @param {String|Number} args.sid - User's web socket connection ID.
   */
  constructor(args = {}) {
    if (!args.name) throw new Error('No args.name was provided when contructing a Participant.');
    this.name = args.name;
    this.device = coerce(DeviceType, args.device) || DeviceType.Unknown;
    this.id = args.id || uuid();
    this.sid = args.sid || null; // Socket ID for the user's connection
  }
  /**
   * Converts instanceof Participant to a FlatBuffer for sending via WebSocket.
   * @returns {FlatBuffer}
   * @memberof Participant
   */
  toFlatBuffer() {
    const { Participant: ParticipantBuffer } = Transport.FlatBuffers;
    const builder = new Builder();
    const nameBuffer = builder.createString(this.name);
    ParticipantBuffer.startParticipant(builder);
    ParticipantBuffer.addId(builder, this.id);
    ParticipantBuffer.addName(builder, nameBuffer);
    builder.finish(ParticipantBuffer.endParticipant(builder));
    return builder.asUint8Array();
  }
}

/**
 * Takes a compressed byte array FlatBuffer and rehydrates it into an Participant.
 * @param {UInt8Array} buffer - The buffer
 * @returns {Participant} Rehydrated participant.
 */
Participant.fromFlatBuffer = function fromFlatBuffer(buffer) {
  const bb = new ByteBuffer(buffer);
  const buffP = Transport.FlatBuffers.Participant.getRootAsParticipant(bb);
  return new Participant({ name: buffP.name(), id: buffP.id() });
};

module.exports = Participant;
