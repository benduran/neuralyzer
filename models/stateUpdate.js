
const { Builder, ByteBuffer } = require('flatbuffers').flatbuffers;

const importSchema = require('../flatbuffer/importSchema');
const RoomObject = require('./roomObject');

const { Transport } = importSchema('StateUpdate');

/**
 * @class StateUpdate
 * @description Represents an incoming or outgoing room state update event.
 * Format for the create and update arguments are the following:
 * [{objectId: { id: objectId, ...objectDetails }}], where the key is the object's unique ID
 */
class StateUpdate {
  /**
   * @constructs StateUpdate
   * @param {Object} [args={}] - Top-level properties get merged into the global room state.
   * @param {Object[]} args.create - New objects that are being added to the room state.
   * @param {Object[]} args.update -  Objects that are being updated. These should already exist in the room state.
   * @param {String[]} args.delete - Array of object uuids that will be deleted from the room state.
   * @param {Object} args.props - Arbitrary props that will be persisted via a state update.
   */
  constructor(args = {}) {
    // Pretty simple. Basically just a passthrough class.
    // We are going to enforce some semblance of schema here, though
    this.create = (Array.isArray(args.create) ? args.create : []).map(ro => new RoomObject(ro.id, ro.props, ro.owner, ro.disposable, ro.name));
    this.update = (Array.isArray(args.update) ? args.update : []).map(ro => new RoomObject(ro.id, ro.props, ro.owner, ro.disposable, ro.name));
    this.delete = Array.isArray(args.delete) ? args.delete : [];
    this.props = typeof args.props === 'object' && args.props !== null ? args.props : {};
  }
  /**
   * Merges two state updates into a single state update object.
   * Used for compressing number of state update messages that will be sent out to participants.
   * @memberof StateUpdate
   * @param {StateUpdate} mergable - Update to merge with the current instance
   * @returns {StateUpdate} New, merged state update object.
   */
  merge(mergable) {
    if (!mergable) return this;
    const out = new StateUpdate({
      create: this.create.concat(mergable.create),
      delete: this.delete.concat(mergable.delete),
      props: {
        ...this.props,
        ...mergable.props,
      },
    });
    this.update.forEach((ro) => {
      const umatch = mergable.update.find(o => o.id === ro.id);
      // Take props from both
      if (umatch) out.update.push(new RoomObject(ro.id, { ...ro.props, ...umatch.props }, ro.owner, ro.disposable, umatch.name || ro.name));
      else out.update.push(ro);
    });
    mergable.update.forEach((ro) => {
      if (!this.update.some(o => o.id === ro.id)) out.update.push(ro);
    });
    return out;
  }
  /**
   * Overriding of the default object toJSON behavior.
   * Prevents empty properties from being serialized, and eventually sent out over the wire.
   */
  toJSON() {
    const out = {};
    if (Object.keys(this.create).length) out.create = this.create;
    if (Object.keys(this.update).length) out.update = this.update;
    if (Object.keys(this.props).length) out.props = this.props;
    if (this.delete.length) out.delete = this.delete;
    return out;
  }
  /**
   * Converts instance of StateUpdate to a buffer to prep it for FlatBufferization.
   * @param {Builder} builder - Instance of Flat Buffer builder.
   * @memberof StateUpdate
   * @returns {Offset} Offset for packing into a Flat Buffer.
   */
  toOffset(builder) {
    // TODO: This is super specific to OnSight. Make generic plz.
    const {
      StateUpdate: StateUpdateBuffer,
      TargetPlacement: TargetPlacementBuffer,
      Vector3: Vector3Buffer,
      Annotation: AnnotationBuffer,
    } = Transport.FlatBuffers;
    if (!builder || !(builder instanceof Builder)) throw new Error('Cannot convert StateUpdate to an offset without a valid builder.');
    let siteDrive = null;
    if (this.props.siteDrive) siteDrive = builder.createString(this.props.siteDrive);
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
      annotations = StateUpdateBuffer.createAnnotationsVector(builder, annotationBuffers);
    }
    let create = null;
    if (this.create.length) {
      create = StateUpdateBuffer.createCreateVector(builder, this.create.map(ro => ro.toOffset(builder)));
    }
    let update = null;
    if (this.update.length) {
      update = StateUpdateBuffer.createUpdateVector(builder, this.update.map(ro => ro.toOffset(builder)));
    }
    let toDelete = null;
    if (this.delete.length) {
      toDelete = StateUpdateBuffer.createDeleteVector(builder, this.delete);
    }
    StateUpdateBuffer.startStateUpdate(builder);
    if (siteDrive) StateUpdateBuffer.addSiteDrive(builder, siteDrive);
    if (poi) StateUpdateBuffer.addPoi(builder, poi);
    if (annotations) StateUpdateBuffer.addAnnotations(builder, annotations);
    if (create) StateUpdateBuffer.addCreate(builder, create);
    if (update) StateUpdateBuffer.addUpdate(builder, update);
    if (toDelete) StateUpdateBuffer.addDelete(builder, toDelete);
    return StateUpdateBuffer.endStateUpdate(builder);
  }
  /**
   * Converts this instance of StateUpdate to a FlatBuffer for sending over the wire.
   * @memberof StateUpdate
   * @returns {FlatBuffer}
   */
  toFlatBuffer() {
    const builder = new Builder();
    builder.finish(this.toOffset(builder));
    return builder.asUint8Array();
  }
}

/**
 * Takes a compressed byte array and deserializes it back into a StateUpdate object.
 * @param {UInt8Array} buffer - The buffer
 * @returns {StateUpdate} Rehydrated state update object
 */
StateUpdate.fromFlatBuffer = function fromFlatBuffer(buffer) {
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
      const prefab = roBuff.prefab();
      if (prefab) ro.props.prefab = prefab;
      const isHidden = roBuff.isHidden();
      if (typeof isHidden === 'boolean') ro.props.isHidden = isHidden;
      out.push(ro);
    }
    return out;
  }
  const bb = new ByteBuffer(buffer);
  const buffSU = Transport.FlatBuffers.StateUpdate.getRootAsStateUpdate(bb);
  const su = new StateUpdate();
  const siteDrive = buffSU.siteDrive();
  if (siteDrive) su.props.siteDrive = siteDrive;
  const poi = buffSU.poi();
  if (poi) {
    const position = poi.position();
    su.props.poi = {
      x: position.x(),
      y: position.y(),
      z: position.z(),
    };
  }
  const annotationsCount = buffSU.annotationsLength();
  if (annotationsCount) {
    su.props.annotations = [];
    for (let i = 0; i < annotationsCount; i++) {
      const annotation = buffSU.annotations(i);
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
      su.props.annotations.push(outAnnotation);
    }
  }
  // TODO: Bind is gross here. Please revisit.
  su.create = buffToRO(buffSU.create.bind(buffSU), buffSU.createLength());
  su.update = buffToRO(buffSU.update.bind(buffSU), buffSU.updateLength());
  const deleteCount = buffSU.deleteLength();
  for (let i = 0; i < deleteCount; i++) {
    su.delete.push(buffSU.delete(i));
  }
  return su;
};

module.exports = StateUpdate;
