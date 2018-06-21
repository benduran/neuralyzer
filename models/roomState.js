
const clone = require('clone');
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;

const importSchema = require('../flatbuffer/importSchema');
const RoomObject = require('./roomObject');
const { objects } = require('../util');

const { Transport } = importSchema('RoomState');
/**
 * @class RoomState
 * @description Represents a collection of properties and objects relating to an in-memory room.
 */
class RoomState {
  /**
   * @constructs RoomState
   * @param {Object} props - Top-level properties to be available in the room state.
   * @param {Objects} objs - key-value pair of object UUIDs to the RoomObjects that will be kept in state.
   */
  constructor(props, objs) {
    this.props = typeof props === 'object' && props !== null ? props : {};
    this.objects = typeof objs === 'object' && objs !== null ? objs : {};
    Object.keys(this.objects).forEach((id) => {
      // Coalece the objects into actual room objects,
      // but only if they're not already in the correct shape
      if (!(this.objects[id] instanceof RoomObject)) {
        this.objects[id] = new RoomObject(id, objects.omit(this.objects[id].props || this.objects[id].props, 'id'));
      }
    });
  }
  /**
   * Takes a state update object and transforms the current room state, based on the update.
   * Returns a new RoomState object with the changes applied.
   * @param {StateUpdate} update - StateUpdate object to apply to this instance of the RoomState.
   * @return {RoomState}
   */
  applyStateUpdate(update) { // todo: ben should probably look at this. Not sure if this will end up being the best fix
    const newProps = { ...this.props, ...update.props };
    const cloned = clone(this.objects); // safely clone the current state of this.objects
    if (Array.isArray(update.delete)) {
      update.delete.forEach((id) => { delete cloned[id]; });
    }
    if (Array.isArray(update.update)) {
      update.update.forEach((obj) => {
        if (!cloned[obj.id]) {
          // if the object did not already exist then this update, was probably a "create" that was missed, so move it to the create array instead.
          update.create.push(obj);
        } else {
          cloned[obj.id] = new RoomObject(obj.id,
            obj.props,
            cloned[obj.id].owner,
            cloned[obj.id].disposable,
            cloned[obj.id].name);
        }
      });
    }
    if (Array.isArray(update.create)) {
      update.create.forEach((obj) => {
        cloned[obj.id] = new RoomObject(obj.id, obj.props, obj.owner, obj.disposable, obj.name);
      });
    }

    return new RoomState(newProps, cloned);
  }
  /**
   * Converts the instance of Room State to an offset in a FlatBuffer.
   * @param {Builder} builder - FlatBuffer builder
   * @returns {Offset} Offset for packing into a Flat Buffer
   * @memberof RoomState
   */
  toOffset(builder) {
    // TODO: This is not generic enough to allow it to work for any application that "isn't" OnSight / ASTTRO.
    const {
      RoomState: RoomStateBuffer,
      TargetPlacement: TargetPlacementBuffer,
      Vector3: Vector3Buffer,
      Annotation: AnnotationBuffer,
      RoomObject: RoomObjectBuffer,
    } = Transport.FlatBuffers;
    // All dependencies to the RoomState have to be created BEFORE startRoomState called.
    let sitedrive = null;
    if (this.props.siteDrive) {
      sitedrive = builder.createString(this.props.siteDrive);
    }
    let poi = null;
    if (this.props.poi) {
      const garbageName = builder.createString('');
      TargetPlacementBuffer.startTargetPlacement(builder);
      TargetPlacementBuffer.addId(builder, Number.MIN_SAFE_INTEGER);
      TargetPlacementBuffer.addName(builder, garbageName);
      TargetPlacementBuffer.addPosition(
        builder,
        Vector3Buffer.createVector3(
          builder,
          this.props.poi.x,
          this.props.poi.y,
          this.props.poi.z,
        ),
      );
      poi = TargetPlacementBuffer.endTargetPlacement(builder);
    }
    let annotations = null;
    if (Array.isArray(this.props.annotations) && this.props.annotations.length) {
      // Need to initialize the annotations positions vector FIRST,
      // but only after we've actually determined that we have at least one annotation
      // worth instantiating. We don't want to pack nothingness.
      // We are going to actually have some annotation worth packing.
      let annotationBuffers = [];
      this.props.annotations.forEach(({ positions, lineId, userId }) => {
        let positionsVector = null;
        if (positions.length) {
          AnnotationBuffer.startPositionsVector(builder, positions.length);
          positions.forEach(({ x, y, z }) => Vector3Buffer.createVector3(builder, x, y, z));
          positionsVector = builder.endVector();
        }
        let lineIdBuff = null;
        if (lineId) lineIdBuff = builder.createString(lineId);
        let userIdbuff = null;
        if (userId) userIdbuff = builder.createString(userId);
        AnnotationBuffer.startAnnotation(builder);
        if (lineIdBuff) AnnotationBuffer.addLineId(builder, lineIdBuff);
        if (userIdbuff) AnnotationBuffer.addUserId(builder, userIdbuff);
        if (positionsVector) AnnotationBuffer.addPositions(builder, positionsVector);
        const annotationBuff = builder.endObject();
        annotationBuffers = annotationBuffers.concat(annotationBuff);
      });
      annotations = RoomStateBuffer.createAnnotationsVector(builder, annotationBuffers);
    }
    const objectIds = Object.keys(this.objects);
    let objectToPack = null;
    if (objectIds.length) {
      let objectBuffers = [];
      objectIds.forEach((oid) => {
        const obj = this.objects[oid];
        const owner = builder.createString(obj.owner);
        if (obj.props.prefab) {
          const prefab = builder.createString(obj.prefab);
          RoomObjectBuffer.addPrefab(builder, prefab);
        }
        RoomObjectBuffer.startRoomObject(builder);
        RoomObjectBuffer.addOwner(builder, owner);
        if (obj.props.lookDirection) {
          RoomObjectBuffer.addLookDirection(
            builder,
            Vector3Buffer.createVector3(builder, obj.props.lookDirection.x, obj.props.lookDirection.y, obj.props.lookDirection.z),
          );
        }
        if (obj.props.position) {
          RoomObjectBuffer.addPosition(
            builder,
            Vector3Buffer.createVector3(builder, obj.props.position.x, obj.props.position.y, obj.props.position.z),
          );
        }
        RoomObjectBuffer.addId(builder, oid);
        RoomObjectBuffer.addDisposable(builder, obj.disposable);
        if (obj.name) {
          const name = builder.createString(obj.name);
          RoomObjectBuffer.addName(builder, name);
        }
        const roomStateBuff = builder.endObject(builder);
        objectBuffers = objectBuffers.concat([roomStateBuff]);
      });
      objectToPack = RoomStateBuffer.createObjectsVector(builder, objectBuffers);
    }
    RoomStateBuffer.startRoomState(builder);
    if (sitedrive) RoomStateBuffer.addSiteDrive(builder, sitedrive);
    if (poi) RoomStateBuffer.addPoi(builder, poi);
    if (annotations) RoomStateBuffer.addAnnotations(builder, annotations);
    if (objectToPack) RoomStateBuffer.addObjects(builder, objectToPack);
    return builder.finish(RoomStateBuffer.endRoomState(builder));
  }
  /**
   * Converts instanceof RoomState to a FlatBuffer for sending via WebSocket.
   * The server's version of this object and the version that is sent out over the wire
   * are not identical, due to different needs of the client(s) and server.
   * @returns {FlatBuffer}
   * @memberof RoomState
   */
  toFlatBuffer() {
    const builder = new Builder();
    this.toOffset(builder);
    return builder.asUint8Array();
  }
}

/**
 * Takes a compressed byte array FlatBuffer and rehydrates it into a RoomStateObject.
 * @param {UInt8Array} buffer - The buffer
 * @returns {RoomObject} Rehydrated room state object.
 */
RoomState.fromFlatBuffer = function fromFlatBuffer(buffer) {
  const bb = new ByteBuffer(buffer);
  const buffRoomState = Transport.FlatBuffers.RoomState.getRootAsRoomState(bb);
  const out = new RoomState();
  const sitedrive = buffRoomState.siteDrive();
  if (sitedrive) out.props.siteDrive = sitedrive;
  const poi = buffRoomState.poi();
  if (poi) {
    const position = poi.position();
    out.props.poi = {
      x: position.x(),
      y: position.y(),
      z: position.z(),
    };
  }
  const numOfAnnotations = buffRoomState.annotationsLength();
  if (numOfAnnotations) {
    out.props.annotations = [];
    for (let i = 0; i < numOfAnnotations; i++) {
      const annotation = buffRoomState.annotations(i);
      const outAnnotation = {
        userId: annotation.userId(),
        lineId: annotation.lineId(),
        positions: [],
      };
      const numOfPositions = annotation.positionsLength();
      for (let j = 0; j < numOfPositions; j++) {
        const annotationPos = annotation.positions(i);
        outAnnotation.positions.push({
          x: annotationPos.x(),
          y: annotationPos.y(),
          z: annotationPos.z(),
        });
      }
      out.props.annotations.push(outAnnotation);
    }
  }
  const numOfObjects = buffRoomState.objectsLength();
  if (numOfObjects) {
    for (let i = 0; i < numOfObjects; i++) {
      const obj = buffRoomState.objects(i);
      const lookDirection = obj.lookDirection();
      const prefab = obj.prefab();
      const position = obj.position();
      const isHidden = obj.isHidden();
      const name = obj.name();
      const outObj = new RoomObject(obj.id(), undefined, obj.owner(), obj.disposable(), name);
      if (lookDirection) {
        outObj.props.lookDirection = {
          x: lookDirection.x(),
          y: lookDirection.y(),
          z: lookDirection.z(),
        };
      }
      if (position) {
        outObj.props.position = {
          x: position.x(),
          y: position.y(),
          z: position.z(),
        };
      }
      if (prefab) outObj.props.prefab = prefab;
      if (typeof isHidden === 'boolean') outObj.props.isHidden = isHidden;
      out.objects[outObj.id] = outObj;
    }
  }
  return out;
};

module.exports = RoomState;
