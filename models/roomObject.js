
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;
const { Transport } = require('../flatbuffer/RoomObject_generated').Neuralyzer;

/**
 * @class RoomObject
 * @description Represents an object that is kept inside of a room's state.
 */
class RoomObject {
  /**
   * @constructs RoomObject
   * @param {Number} id - Unique integer of the game object in the room
   * @param {Object} [props={}] - Properties that will be stored on the room object
   * @param {String} [owner=''] - Person that created the object.
   * @param {Boolean} [disposable=false] - If true, object will automatically be destroyed when the user that
   * @param {String} [name=''] - Sets the name property of the game object.
   * created it has left the room.
   */
  constructor(id, props, owner = null, disposable = false, name = '') {
    this.id = id;
    this.props = typeof props !== 'object' || props === null ? {} : props;
    this.disposable = disposable;
    this.owner = owner || '';
    this.name = name || '';
  }
  /**
   * Converts instance of RoomObject to a buffer to prep it for FlatBufferization
   * @param {Builder} builder - Instance of FlatBuffer builder.
   * @memberof RoomObject
   * @returns {Offset} Offset for packing into a Flat Buffer
   */
  toOffset(builder) {
    if (!builder || !(builder instanceof Builder)) throw new Error('Cannot convert RoomObject to an offset without a valid builder.');
    const { RoomObject: RoomObjectBuffer, Vector3: Vector3Buffer } = Transport.FlatBuffers;
    const owner = builder.createString(this.owner);
    let name = null;
    if (this.name) name = builder.createString(this.name);
    let prefab = '';
    if (this.props.prefab) prefab = builder.createString(this.props.prefab);
    RoomObjectBuffer.startRoomObject(builder);
    RoomObjectBuffer.addId(builder, this.id);
    RoomObjectBuffer.addDisposable(builder, this.disposable);
    RoomObjectBuffer.addOwner(builder, owner);
    if (this.props.lookDirection) {
      RoomObjectBuffer.addLookDirection(
        builder,
        Vector3Buffer.createVector3(builder, this.props.lookDirection.x, this.props.lookDirection.y, this.props.lookDirection.z),
      );
    }
    if (this.props.position) {
      RoomObjectBuffer.addPosition(
        builder,
        Vector3Buffer.createVector3(builder, this.props.position.x, this.props.position.y, this.props.position.z),
      );
    }
    if (this.props.isHidden) RoomObjectBuffer.addIsHidden(builder, this.props.isHidden);
    if (prefab) RoomObjectBuffer.addPrefab(builder, prefab);
    if (this.name) RoomObjectBuffer.addName(builder, name);
    return RoomObjectBuffer.endRoomObject(builder);
  }
  /**
   * Converts instanceof RoomObject to a FlatBuffer for sending via WebSocket.
   * The server's version of this object and the version that is sent out over the wire
   * are not identical, due to different needs of the client(s) and server.
   * @returns {FlatBuffer}
   * @memberof RoomObject
   */
  toFlatBuffer() {
    // TODO: This is a hyper-specific implmentation for OnSight that needs to be genericized.
    // Nobody will ever be able to use this otherwise.
    const builder = new Builder();
    builder.finish(this.toOffset(builder));
    return builder.asUint8Array();
  }
}

/**
 * Takes a compressed byte array FlatBuffer and rehydrates it into a RoomObject.
 * @param {UInt8Array} buffer - The buffer
 * @returns {RoomObject} Rehydrated room object.
 */
RoomObject.fromFlatBuffer = function fromFlatBuffer(buffer) {
  // TODO: This is a hyper-specific implmentation for OnSight that needs to be genericized.
  // Nobody will ever be able to use this otherwise.
  const bb = new ByteBuffer(buffer);
  const buffRO = Transport.FlatBuffers.RoomObject.getRootAsRoomObject(bb);
  const ro = new RoomObject(buffRO.id(), {}, buffRO.owner(), buffRO.disposable(), buffRO.name());
  const lookDirection = buffRO.lookDirection();
  if (lookDirection) {
    ro.props.lookDirection = {
      x: lookDirection.x(),
      y: lookDirection.y(),
      z: lookDirection.z(),
    };
  }
  const position = buffRO.position();
  if (position) {
    ro.props.position = {
      x: position.x(),
      y: position.y(),
      z: position.z(),
    };
  }
  const prefab = buffRO.prefab();
  if (prefab) ro.props.prefab = prefab;
  const isHidden = buffRO.isHidden();
  if (typeof isHidden === 'boolean') ro.props.isHidden = isHidden;
  return ro;
};

module.exports = RoomObject;
