
/* globals describe it */

const { expect } = require('chai');
const uuid = require('uuid/v4');
const fetch = require('node-fetch');

const config = require('../config');
const { setupWebsocketAndRoom } = require('./util');
const { SocketEvents } = require('../constants');

const { heartbeatInterval } = config.server.sockets;

describe('Rooms list query tests', () => {
  process.env.NEURALYZER_NODE_ENV = 'test';
  it(
    'Should connect a user and join a room. Then, after the room has been joined, query the REST endpoint for available rooms.',
    () => new Promise(async (resolve, reject) => {
      const roomname = 'join_then_query_rooms_list';
      const uname = `${roomname}_user_1`;
      const uid = uuid();
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
          // let's do the query!
          try {
            const rooms = await (await fetch(`http://localhost:${config.server.port}/api/rooms`)).json();
            expect(rooms).to.not.be.a('null');
            expect(rooms).to.not.be.empty; // eslint-disable-line
            expect(rooms[0].name).to.equal(roomname);
            expect(rooms[0].id).to.not.be.an('undefined');
            expect(rooms[0].id).to.not.be.a('null');
            expect(rooms[0].id).to.not.be.empty; // eslint-disable-line
            expect(rooms[0].participants).to.not.be.empty; // eslint-disable-line
            expect(rooms[0].participants[0].name).to.equal(uname);
            done();
          } catch (error) { done(error); }
        }
      }
      try {
        socket = await setupWebsocketAndRoom({
          room: roomname,
          username: uname,
          userId: uid,
          onmessage: onMessage,
          device,
        });
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * 3);
});
