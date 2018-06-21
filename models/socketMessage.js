
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;

const importSchema = require('../flatbuffer/importSchema');
const StateUpdate = require('./stateUpdate');
const RoomObject = require('./roomObject');
const CreateJoinRequest = require('./createJoinRequest');
const { SocketEvents, RoomEvents } = require('../constants');
const { flatbuffers } = require('../config').server.sockets;

const { Transport } = importSchema('Transport');

/**
 * Takes a server-specific string msgType
 * and converts it to the relevant transport flat-buffer msgType.
 * @param {any} msgType - String message type from constants SocketEvents or RoomEvents
 * @returns {Number} Transport msgType byte enum or undefined if a match isn't found.
 */
function serverMsgTypeToTransportMsgType(msgType) {
  const { msgType: MsgType } = Transport.FlatBuffers;
  switch (msgType) {
    case RoomEvents.RoomStateUpdate:
      return MsgType.RoomStateUpdate;
    case SocketEvents.ConnectionReady:
      return MsgType.SocketReady;
    case SocketEvents.RoomJoined:
      return MsgType.SocketRoomJoined;
    case RoomEvents.RoomCreated:
      return MsgType.RoomCreated;
    case RoomEvents.OnUserJoinedRoom:
      return MsgType.RoomUserOnjoined;
    case RoomEvents.OnLeaveUserFromRoom:
      return MsgType.RoomUserOnLeft;
    case SocketEvents.CreateOrJoinRoom:
      return MsgType.SocketCreateOrJoinRoom;
    case SocketEvents.Blip:
      return MsgType.SocketBlip;
    case SocketEvents.Pulse:
      return MsgType.SocketPulse;
    default:
      return undefined;
  }
}

/**
 * Takes a trannsport-specific string msgType
 * and converts it to the relevant server message type.
 * @param {any} msgType - String message type from available transport message types compiled from Transport.fbs.
 * @returns {SocketEvent|RoomEvent} MSG type native to neuralyzer server.
 */
function transportMsgTypeToServerMsgType(msgType) {
  const { msgType: MsgType } = Transport.FlatBuffers;
  switch (msgType) {
    case MsgType.RoomStateUpdate:
      return RoomEvents.RoomStateUpdate;
    case MsgType.SocketReady:
      return SocketEvents.ConnectionReady;
    case MsgType.SocketRoomJoined:
      return SocketEvents.RoomJoined;
    case MsgType.RoomCreated:
      return RoomEvents.RoomCreated;
    case MsgType.RoomUserOnjoined:
      return RoomEvents.OnUserJoinedRoom;
    case MsgType.RoomUserOnLeft:
      return RoomEvents.OnLeaveUserFromRoom;
    case MsgType.SocketCreateOrJoinRoom:
      return SocketEvents.CreateOrJoinRoom;
    case MsgType.SocketBlip:
      return SocketEvents.Blip;
    case MsgType.SocketPulse:
      return SocketEvents.Pulse;
    default:
      return undefined;
  }
}

/**
 * @class SocketMessage
 * @description Represents a message that will be broadcasted out over a Redis channel.
 */
class SocketMessage {
  /**
   * @constructs SocketMessage
   * @param {Object} args
   * @param {String} args.msgType - Type of message that is being broadcasted out over the Redis channel.
   * @param {Object|String|Number} args.data - Data to be broadcasted out as part of the message.
   */
  constructor(args = {}) {
    if (!args.msgType) throw new Error('msgType is required when creating a SocketMessage.');
    this.msgType = args.msgType;
    this.data = args.data;
  }
  /**
   * Prepares this instance of SocketMessage to be sent out over the wire in a JSON string format.
   * If the flatbuffers.enabled flag is set to "true" in the server config, a flat buffer is returned instead.
   * @returns {String|FlatBuffer}
   * @memberof SocketMessage
   */
  toWire() {
    if (flatbuffers.enabled) return this.toFlatBuffer();
    const isPulseOrBlip = this.msgType === SocketEvents.Pulse || this.msgType === SocketEvents.Blip;
    const out = { msgType: this.msgType };
    if (!isPulseOrBlip && this.data && Object.keys(this.data).length) out.data = this.data;
    return JSON.stringify(out);
  }
  /**
   * Converts instanceof SocketMessage to a FlatBuffer for sending via WebSocket.
   * The server's version of this object and the version that is sent out over the wire
   * are not identical, due to different needs of the client(s) and server.
   * @returns {FlatBuffer}
   * @memberof SocketMessage
   */
  toFlatBuffer() {
    const {
      StringData,
      ServerMessage: ServerMessageBuffer,
      msg: MsgFormat,
    } = Transport.FlatBuffers;
    const builder = new Builder();
    const msgType = serverMsgTypeToTransportMsgType(this.msgType);
    // If the user joined a room, then they get a generic state update message
    if (this.msgType === RoomEvents.RoomStateUpdate || this.msgType === SocketEvents.RoomJoined) {
      const stateUpdateBuff = this.data.toOffset(builder);
      ServerMessageBuffer.startServerMessage(builder);
      ServerMessageBuffer.addData(builder, stateUpdateBuff);
      ServerMessageBuffer.addDataType(builder, MsgFormat.StateUpdate);
    } else if (this.msgType === SocketEvents.CreateOrJoinRoom) {
      const joinBuff = this.data.toOffset(builder);
      ServerMessageBuffer.startServerMessage(builder);
      ServerMessageBuffer.addData(builder, joinBuff);
      ServerMessageBuffer.addDataType(builder, MsgFormat.JoinCreateRequest);
    } else if (this.data) {
      const dataStr = builder.createString(this.data);
      StringData.startStringData(builder);
      StringData.addData(builder, dataStr);
      const strDataBuff = StringData.endStringData(builder);
      ServerMessageBuffer.startServerMessage(builder);
      ServerMessageBuffer.addData(builder, strDataBuff);
      ServerMessageBuffer.addDataType(builder, MsgFormat.StringData);
    } else {
      ServerMessageBuffer.startServerMessage(builder);
      ServerMessageBuffer.addDataType(builder, MsgFormat.StringData);
    }
    ServerMessageBuffer.addType(builder, msgType);
    builder.finish(ServerMessageBuffer.endServerMessage(builder));
    return builder.asUint8Array();
  }
}

/**
 * Takes a compressed byte array and deserializes it back into a SocketMessage object.
 * @param {UInt8Array} buffer - The buffer.
 * @returns {StateUpdate} Rehydrated socket mesage object.
 */
SocketMessage.fromFlatBuffer = function fromFlatBuffer(buffer) {
  function buffToRO(buff, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const roBuff = buff(i);
      const ro = new RoomObject(roBuff.id(), {}, roBuff.owner(), roBuff.disposable(), roBuff.name());
      const lookDirection = roBuff.lookDirection();
      if (lookDirection) {
        ro.props.lookDirection = {
          x: lookDirection.x(),
          y: lookDirection.y(),
          z: lookDirection.z(),
        };
      }
      const position = roBuff.position();
      if (position) {
        ro.props.position = {
          x: position.x(),
          y: position.y(),
          z: position.z(),
        };
      }
      out.push(ro);
      const prefab = roBuff.prefab();
      if (prefab) ro.props.prefab = prefab;
      const isHidden = roBuff.isHidden();
      if (typeof isHidden === 'boolean') ro.props.isHidden = isHidden;
    }
    return out;
  }
  const bb = new ByteBuffer(buffer);
  const smBuff = Transport.FlatBuffers.ServerMessage.getRootAsServerMessage(bb);
  const transportMessageType = smBuff.type();
  const sm = new SocketMessage({
    msgType: transportMsgTypeToServerMsgType(transportMessageType),
  });
  const { msgType: MsgType } = Transport.FlatBuffers;
  if (transportMessageType === MsgType.RoomStateUpdate || transportMessageType === MsgType.SocketRoomJoined) {
    const data = smBuff.data(new Transport.FlatBuffers.StateUpdate());
    sm.data = new StateUpdate();
    const sitedrive = data.siteDrive();
    if (sitedrive) sm.data.props.siteDrive = sitedrive;
    const poi = data.poi();
    if (poi) {
      const position = poi.position();
      sm.data.props.poi = {
        x: position.x(),
        y: position.y(),
        z: position.z(),
      };
    }
    const annotationsCount = data.annotationsLength();
    if (annotationsCount) {
      sm.data.props.annotations = [];
      for (let i = 0; i < annotationsCount; i++) {
        const annotation = data.annotations(i);
        const outAnnotation = {
          userId: annotation.userId(),
          lineId: annotation.lineId(),
          positions: [],
        };
        const numOfPositions = annotation.positionsLength();
        for (let j = 0; j < numOfPositions; j++) {
          const annotationPos = annotation.positions(j);
          outAnnotation.positions.push({
            x: annotationPos.x(),
            y: annotationPos.y(),
            z: annotationPos.z(),
          });
        }
        sm.data.props.annotations.push(outAnnotation);
      }
    }
    sm.data.create = buffToRO(data.create.bind(data), data.createLength());
    sm.data.update = buffToRO(data.update.bind(data), data.updateLength());
    const deleteCount = data.deleteLength();
    for (let i = 0; i < deleteCount; i++) {
      sm.data.delete.push(data.delete(i));
    }
  } else if (transportMessageType === MsgType.SocketCreateOrJoinRoom) {
    const data = smBuff.data(new Transport.FlatBuffers.JoinCreateRequest());
    sm.data = new CreateJoinRequest(data.room(), data.name(), data.userId(), data.deviceType());
  } else {
    const data = smBuff.data(new Transport.FlatBuffers.StringData());
    if (data) sm.data = data.data();
  }
  return sm;
};

/**
 * Takes a message received over the wire and converts it to the format currently supported by the server.
 * This format is dependent upon the flatbuffers.enabled flag being true or false.
 * @param {String|Byte[]} msg - Message received from a websocket onmessage event.
 * @returns {SocketMessage}
 */
SocketMessage.fromWire = function fromWire(msg) {
  return flatbuffers.enabled ? SocketMessage.fromFlatBuffer(msg) : JSON.parse(msg);
};

module.exports = SocketMessage;
