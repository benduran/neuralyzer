
/* globals describe it before after */

const { expect } = require('chai');

const config = require('../config');
const { setupWebsocketAndRoom, createRandomRoomObject } = require('./util');
const RedisClient = require('../redisClient');
const { RoomEvents, SocketEvents } = require('../constants');
const { SocketMessage, StateUpdate } = require('../models');

const { heartbeatInterval } = config.server.sockets;

describe('State change and sync tests', () => {
  let redisClient = null;
  before((done) => {
    redisClient = new RedisClient();
    redisClient.init().then(done);
  });
  after((done) => {
    redisClient.close().then(done);
  });
  it(
    'Should join two users to a room. Then, one user will create items and the other will receive the socket state update',
    () => new Promise(async (resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      const roomname = 'test_state_sync_message';
      const username1 = `${roomname}_user_1`;
      const username2 = `${roomname}_user_2`;
      const userid1 = Date.now();
      const userid2 = userid1 + 10;
      const device = 'browser';
      const itemId1 = 182939821;
      const itemId2 = 8439534;
      const item1 = createRandomRoomObject(false, true, true);
      item1.id = itemId1;
      item1.owner = userid1.toString();
      const item2 = createRandomRoomObject(false, false, true);
      item2.id = itemId2;
      item2.owner = userid1.toString();
      const stateUpdate = new StateUpdate({
        create: [item1, item2],
      });
      const msg = new SocketMessage({
        data: stateUpdate,
        msgType: RoomEvents.RoomStateUpdate,
      });
      function shutdown(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        setTimeout(() => {
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      function onMessage1({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          socket1.send(msg.toWire());
        }
      }
      function onMessage2({ data }) {
        try {
          if (data.msgType === RoomEvents.RoomStateUpdate) {
            expect(data).to.not.be.empty; // eslint-disable-line
            expect(data.data.create).to.eql(stateUpdate.create, 'owner');
            shutdown();
          }
        } catch (error) { shutdown(error); }
      }
      try {
        const [s1, s2] = await Promise.all([
          setupWebsocketAndRoom({
            room: roomname,
            username: username1,
            userId: userid1,
            onmessage: onMessage1,
            wait: 100,
            device,
          }),
          setupWebsocketAndRoom({
            room: roomname,
            username: username2,
            userId: userid2,
            onmessage: onMessage2,
            device,
          }),
        ]);
        socket1 = s1;
        socket2 = s2;
      } catch (error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        reject(error);
      }
    }),
  ).timeout(heartbeatInterval * 2);
  it(
    'Should join one user and create some stuff before joining 2nd user and verify that the initial state received looks good.',
    () => new Promise(async (resolve, reject) => {
      const roomname = 'join_one_then_another';
      const username1 = `${roomname}_user_1`;
      const uid1 = Date.now();
      const username2 = `${roomname}_user_2`;
      const uid2 = uid1 + 1234;
      const device = 'browser';
      let socket1 = null;
      let socket2 = null;
      const objid1 = 9120319;
      const obj1 = createRandomRoomObject(false, true, true);
      obj1.id = objid1;
      obj1.owner = uid1.toString();
      function done(error) {
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
            const stateObj = data.data.create.find(o => o.id === objid1);
            expect(stateObj).to.not.be.an('undefined');
            expect(stateObj.id).to.equal(objid1);
            expect(stateObj.owner).to.equal(uid1.toString());
            expect(stateObj).to.eql(obj1);
            done();
          } catch (error) { done(error); }
        }
      }
      function onMessage1({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          const update = new StateUpdate({
            create: [obj1],
          });
          socket1.send(new SocketMessage({
            data: update,
            msgType: RoomEvents.RoomStateUpdate,
          }).toWire());
          // Wait .5s and allow the server to do its stuff
          setTimeout(async () => {
            socket2 = await setupWebsocketAndRoom({
              room: roomname,
              username: username2,
              userId: uid2,
              onmessage: onMessage2,
              device,
            });
          }, 500);
        }
      }
      try {
        socket1 = await setupWebsocketAndRoom({
          room: roomname,
          username: username1,
          userId: uid1,
          onmessage: onMessage1,
          device,
        });
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * 3);
});
