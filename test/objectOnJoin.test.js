
/* globals describe it */

const { expect } = require('chai');

const config = require('../config');
const { setupWebsocketAndRoom, createRandomRoomObject } = require('./util');
const { SocketEvents, RoomEvents } = require('../constants');
const { SocketMessage, StateUpdate } = require('../models');

const { heartbeatInterval } = config.server.sockets;

describe('State objects', () => {
  it(
    'Should connect one user who will create some objects. Then, a second user will join and should receive the room\'s current state.',
    () => new Promise(async (resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      const roomname = 'test_duo_join_then_get_state';
      const uname1 = `${roomname}_user_1`;
      const uname2 = `${roomname}_user_2`;
      const uid1 = Date.now().toString();
      const uid2 = (+uid1 + 1000).toString();
      const device = 'browser';
      const obj1 = createRandomRoomObject(false, true, true);
      const obj2 = createRandomRoomObject(false, true, true);
      obj1.owner = obj2.owner = uid1; // eslint-disable-line
      const update = new StateUpdate({
        create: [obj1, obj2],
      });
      function shutdown(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        setTimeout(() => {
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      function onMessage2({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          try {
            expect(data.data.create.length).to.equal(update.create.length);
            expect(data.data.create).to.eql(update.create);
            shutdown();
          } catch (error) { shutdown(error); }
        }
      }
      async function onMessage1({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          socket1.send(new SocketMessage({
            data: update,
            msgType: RoomEvents.RoomStateUpdate,
          }).toWire());
          socket2 = await setupWebsocketAndRoom({
            room: roomname,
            username: uname2,
            userId: uid2,
            onmessage: onMessage2,
            device,
          });
        }
      }
      try {
        socket1 = await setupWebsocketAndRoom({
          room: roomname,
          username: uname1,
          userId: uid1,
          onmessage: onMessage1,
          device,
        });
      } catch (error) { shutdown(error); }
    }),
  ).timeout(heartbeatInterval * 2);
});
