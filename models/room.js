
const uuid = require('uuid/v4');

const Participant = require('./participant');
const RoomState = require('./roomState');
const StateUpdate = require('./stateUpdate');

/**
 * @class Room
 * @description Represents a room containing users in a collaborative discussion
 */
class Room {
  /**
   * @constructs Room
   * @param {Object} args
   * @param {String} args.name - Name for the room. Used as unique identifier.
   * @param {Participant[]} args.participants - Array of participants in the room.
   * @param {RoomState} args.state - Arbitrary state to store on the room itself.
   * @param {String|Number} args.id - ID for the room.
   * in this instance of Room. Requires external merging with current state property.
   */
  constructor(args = {}) {
    if (!args.name) throw new Error('No args.name was provided when constructing a Room.');
    this.name = args.name; // Used as the unique identifier on the server. Can only have one room per name.
    this.participants = (args.participants || []).map(u => new Participant(u)); // Array of user objects
    this.state = args.state && args.state.props && args.state.objects ? new RoomState(args.state.props, args.state.objects) : new RoomState();
    this.id = args.id || uuid();
  }
  /**
   * Converts bits and bobs of the room's information into a format
   * than can be easily consumed by a client on their initial connection.
   * @memberof Room
   * @returns {StateUpdate} Initial room join state update.
   */
  asRoomJoin() {
    return new StateUpdate({
      props: this.state.props,
      create: Object.values(this.state.objects),
    });
  }
}

module.exports = Room;
