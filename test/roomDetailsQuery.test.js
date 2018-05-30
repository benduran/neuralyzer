
/* globals describe it */

const { expect } = require('chai');
const fetch = require('node-fetch');

const config = require('../config');
const { setupWebsocketAndRoom } = require('./util');
const { SocketEvents } = require('../constants');

const { heartbeatInterval } = config.server.sockets;

describe('Room details query', () => {
  process.env.NEURALYZER_NODE_ENV = 'test';

  it(`Should connect a user and join a room.
  Then, after user has joined, query for details about the specific room.`,
  () => new Promise(async (resolve, reject) => {
    const roomname = 'query_room_details';
    const uname = `${roomname}_user`;
    const uid = Date.now().toString();
    const device = 'browser';
    let socket = null;
    function done(error) {
      if (socket) socket.close();
      setTimeout(() => {
        if (error) return reject(error);
        return resolve();
      }, 200);
    }
    async function onMessage({ data }) {
      if (data.msgType === SocketEvents.RoomJoined) {
        // Time for querying!
        try {
          const roomDetails = await (await fetch(`http://localhost:${config.server.port}/api/room/${roomname}`)).json();
          expect(roomDetails).to.not.be.an('undefined');
          expect(roomDetails).to.not.be.a('null');
          expect(roomDetails.name).to.equal(roomname);
          expect(roomDetails.participants.some(p => p.name === uname)).to.be.ok; // eslint-disable-line
          done();
        } catch (error) { done(error); }
      }
    }
    socket = await setupWebsocketAndRoom({
      device,
      room: roomname,
      username: uname,
      userId: uid,
      onmessage: onMessage,
    });
  })).timeout(heartbeatInterval * 2);
});
