
/* globals describe it before after */
const { promisify } = require('util');

const { expect } = require('chai');
const uuid = require('uuid/v4');

const config = require('../config');
const { setupWebsocketAndRoom, getServerState, createRandomRoomObject } = require('./util');
const RedisClient = require('../redisClient');
const { RoomEvents, SocketEvents } = require('../constants');
const { SocketMessage, StateUpdate } = require('../models');

const { heartbeatInterval } = config.server.sockets;

describe('State change tests', () => {
  process.env.NEURALYZER_NODE_ENV = 'test';
  let redisClient = null;
  let getAsync = null;
  before((done) => {
    redisClient = new RedisClient();
    redisClient.init().then(() => {
      getAsync = promisify(redisClient.pub.get.bind(redisClient.pub));
      done();
    });
  });
  after((done) => {
    redisClient.close().then(done);
  });
  it(`Should join two users to a room and send a state update with a disposable object.
    The user that created the disposable object should leave and the disposable object should be destroyed.`,
  () => new Promise(async (resolve, reject) => {
    let usocket1 = null;
    let usocket2 = null;
    const roomname = 'two_users_a_disposable_object';
    const uname1 = `${roomname}_user_1`;
    const uname2 = `${roomname}_user_2`;
    const uid1 = Date.now();
    const uid2 = uid1 + 1000;
    const device = 'browser';
    const objId = uuid();
    let socket1closed = false;
    function shutdown(err) {
      if (usocket1) usocket1.close();
      if (usocket2) usocket2.close();
      setTimeout(() => {
        if (err) return reject(err);
        return resolve();
      }, 200);
    }
    function onMessage1({ data }) {
      // we are going to join a room in progress
      if (data.msgType === SocketEvents.RoomJoined) {
        const obj = createRandomRoomObject(true, false, true);
        obj.owner = uid1;
        const update = new StateUpdate({
          create: [obj],
        });
        usocket1.send(new SocketMessage({
          data: update,
          msgType: RoomEvents.RoomStateUpdate,
        }).toWire());
      }
    }
    async function onMessage2({ data }) {
      if (data.msgType === RoomEvents.RoomStateUpdate) {
        if (!socket1closed) {
          // Make socket1 leave
          socket1closed = true;
          usocket1.close();
        } else {
          // We need to delay a bit because the user is leaving so we're not going to get any events.
          try {
            const redisAliasKey = await getAsync(redisClient.getRedisRoomAliasKey(roomname));
            const redisRoom = JSON.parse(await getAsync(redisAliasKey));
            const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
            expect(redisRoom).to.not.be.a('null');
            expect(room).to.not.be.an('undefined');
            expect(room.state.objects[objId]).to.be.an('undefined');
            expect(redisRoom.state.objects[objId]).to.be.an('undefined');
            shutdown();
          } catch (error) { shutdown(error); }
        }
      }
    }
    try {
      const [s1, s2] = await Promise.all([
        setupWebsocketAndRoom({
          room: roomname,
          username: uname1,
          userId: uid1,
          onmessage: onMessage1,
          wait: 100,
          device,
        }),
        setupWebsocketAndRoom({
          room: roomname,
          username: uname2,
          userId: uid2,
          onmessage: onMessage2,
          device,
        }),
      ]);
      usocket1 = s1;
      usocket2 = s2;
    } catch (error) {
      shutdown(error);
    }
  })).timeout(heartbeatInterval * 2);
  it('Should join one user to a room and send a state update by creating two new items', () => new Promise(async (resolve, reject) => {
    let socket = null;
    const roomname = 'one_user_two_items';
    const userId = Date.now().toString();
    function onmessage({ data }) {
      if (data.msgType === RoomEvents.RoomCreated) {
        // Send two items out to be stored in room state
        const item1Id = 1;
        const item2Id = 11;
        const item1 = createRandomRoomObject(false, true, false);
        item1.id = item1Id;
        item1.owner = userId;
        const item2 = createRandomRoomObject(false, true, true);
        item2.id = item2Id;
        item2.owner = userId;
        socket.send(new SocketMessage({
          msgType: RoomEvents.RoomStateUpdate,
          data: new StateUpdate({
            create: [item1, item2],
          }),
        }).toWire());
        // Wait a small delay before checking whether the update went through or not.
        // Redis may not have been updated immediately
        setTimeout(async () => {
          try {
            const redisAliasKey = await getAsync(redisClient.getRedisRoomAliasKey(roomname));
            const redisRoom = JSON.parse(await getAsync(redisAliasKey));
            const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
            expect(redisRoom).to.not.be.a('null');
            expect(room).to.not.be.an('undefined');
            expect(redisRoom.state.objects[item1Id]).to.eql(item1);
            expect(redisRoom.state.objects[item2Id]).to.eql(item2);
            expect(room.state.objects[item1Id]).to.eql(item1);
            expect(room.state.objects[item2Id]).to.eql(item2);
            socket.close();
            resolve();
          } catch (error) {
            socket.close();
            reject(error);
          }
        }, 50);
      }
    }
    try {
      socket = await setupWebsocketAndRoom({
        room: roomname,
        username: `${roomname}_user`,
        device: 'browser',
        userId,
        onmessage,
      });
    } catch (error) { reject(error); }
  })).timeout(heartbeatInterval * 2);
  it(
    'Should join one user to a room and update state by creating two items, then sending an update to change an existing item',
    () => new Promise(async (resolve, reject) => {
      let socket = null;
      const roomname = 'test_join_state_update_obj';
      const redisAliasKey = redisClient.getRedisRoomAliasKey(roomname);
      function done(error) {
        if (socket) socket.close();
        setTimeout(() => {
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      function onMessage({ data }) {
        if (data.msgType === RoomEvents.RoomCreated) {
          const itemId1 = 2;
          const itemId2 = 2223;
          const item1 = createRandomRoomObject(false, false, true);
          item1.id = itemId1;
          const item2 = createRandomRoomObject(false, true, false);
          item2.id = itemId2;
          const stateUpdate = new StateUpdate({
            create: [item1, item2],
          });
          const msgToSend = new SocketMessage({
            msgType: RoomEvents.RoomStateUpdate,
            data: stateUpdate,
          });
          socket.send(msgToSend.toWire());
          setTimeout(async () => {
            try {
              const redisRoom = JSON.parse(await getAsync(await getAsync(redisAliasKey)));
              const { rooms } = await getServerState();
              const room = rooms[Object.keys(rooms).find(rid => rooms[rid].name === roomname)];
              expect(room).to.not.be.an('undefined');
              expect(redisRoom).to.not.be.a('null');
              let item1Match = room.state.objects[itemId1];
              let item2Match = room.state.objects[itemId2];
              expect(item1Match).to.not.be.an('undefined');
              expect(item2Match).to.not.be.an('undefined');
              expect(item1Match.props).to.eql(item1.props);
              expect(item2Match.props).to.eql(item2.props);

              item1Match = redisRoom.state.objects[itemId1];
              item2Match = redisRoom.state.objects[itemId2];

              expect(item1Match.props).to.eql(item1.props);
              expect(item2Match.props).to.eql(item2.props);

              item2.props.position.x = 999;
              const anotherUpdate = new StateUpdate({
                update: [item2],
              });
              const anotherMsgToSend = new SocketMessage({
                msgType: RoomEvents.RoomStateUpdate,
                data: anotherUpdate,
              });
              socket.send(anotherMsgToSend.toWire());
              setTimeout(async () => {
                try {
                  const { rooms: updatedRooms } = await getServerState();
                  const updatedRedisRoom = JSON.parse(await getAsync(await getAsync(redisAliasKey)));
                  const updatedRoom = updatedRooms[Object.keys(updatedRooms).find(rid => updatedRooms[rid].name === roomname)];

                  expect(updatedRoom).to.not.be.an('undefined');
                  expect(updatedRedisRoom).to.not.be.a('null');
                  item1Match = updatedRoom.state.objects[itemId1];
                  item2Match = updatedRoom.state.objects[itemId2];
                  expect(item1Match).to.not.be.an('undefined');
                  expect(item2Match).to.not.be.an('undefined');
                  expect(item1Match.props).to.eql(item1.props);
                  expect(item2Match.props).to.eql(item2.props);

                  item1Match = updatedRedisRoom.state.objects[itemId1];
                  item2Match = updatedRedisRoom.state.objects[itemId2];
                  expect(item1Match.props).to.eql(item1.props);
                  expect(item2Match.props).to.eql(item2.props);
                  done();
                } catch (error) { done(error); }
              }, 50);
            } catch (error) { done(error); }
          }, 50);
        }
      }
      try {
        socket = await setupWebsocketAndRoom({
          room: roomname,
          username: `${roomname}_user`,
          userId: Date.now(),
          device: 'browser',
          onmessage: onMessage,
        });
      } catch (error) { reject(error); }
    }),
  ).timeout(heartbeatInterval * 3);
  it('Should join one user to a room, create three items in state, then delete two of them', () => new Promise(async (resolve, reject) => {
    let socket = null;
    const roomname = 'test_state_sync_delete';
    const redisRoomAlias = redisClient.getRedisRoomAliasKey(roomname);
    function shutdown(err) {
      socket.close();
      setTimeout(() => {
        if (err) return reject(err);
        return resolve();
      }, 200);
    }
    function onMessage({ data }) {
      if (data.msgType === RoomEvents.RoomCreated) {
        const itemId1 = 1;
        const itemId2 = 2;
        const itemId3 = 3;
        const item1 = createRandomRoomObject(false, true, true);
        item1.id = itemId1;
        const item2 = createRandomRoomObject(false, true, true);
        item2.id = itemId2;
        const item3 = createRandomRoomObject(false, true, true);
        item3.id = itemId3;
        const stateUpdate = new StateUpdate({
          create: [item1, item2, item3],
        });
        const msgToSend = new SocketMessage({
          msgType: RoomEvents.RoomStateUpdate,
          data: stateUpdate,
        });
        socket.send(msgToSend.toWire());
        setTimeout(async () => {
          try {
            const redisRoom = JSON.parse(await getAsync(await getAsync(redisRoomAlias)));
            const { rooms } = await getServerState();
            const room = rooms[Object.keys(rooms).find(rid => rooms[rid].name === roomname)];
            expect(redisRoom).to.not.be.a('null');
            expect(room).to.not.be.an('undefined');
            let item1Match = room.state.objects[itemId1];
            let item2Match = room.state.objects[itemId2];
            let item3Match = room.state.objects[itemId3];
            expect(item1Match).to.not.be.an('undefined');
            expect(item2Match).to.not.be.an('undefined');
            expect(item3Match).to.not.be.an('undefined');
            item1Match = redisRoom.state.objects[itemId1];
            item2Match = redisRoom.state.objects[itemId2];
            item3Match = redisRoom.state.objects[itemId3];
            expect(item1Match).to.not.be.an('undefined');
            expect(item2Match).to.not.be.an('undefined');
            expect(item3Match).to.not.be.an('undefined');
            expect(item1Match.props).to.eql(item1.props);
            expect(item2Match.props).to.eql(item2.props);
            expect(item3Match.props).to.eql(item3.props);
            const deleteStateUpdate = new StateUpdate({
              delete: [itemId1, itemId2],
            });
            const deleteMsgToSend = new SocketMessage({
              msgType: RoomEvents.RoomStateUpdate,
              data: deleteStateUpdate,
            });
            socket.send(deleteMsgToSend.toWire());
            setTimeout(async () => {
              try {
                const updatedRedisRoom = JSON.parse(await getAsync(await getAsync(redisRoomAlias)));
                const { rooms: updatedRooms } = await getServerState();
                const updatedRoom = updatedRooms[Object.keys(rooms).find(rid => updatedRooms[rid].name === roomname)];
                expect(updatedRedisRoom).to.not.be.a('null');
                expect(updatedRoom).to.not.be.an('undefined');
                item1Match = updatedRoom.state.objects[itemId1];
                item2Match = updatedRoom.state.objects[itemId2];
                item3Match = updatedRoom.state.objects[itemId3];
                expect(item1Match).to.be.an('undefined');
                expect(item2Match).to.be.an('undefined');
                expect(item3Match).to.not.be.an('undefined');
                item1Match = updatedRedisRoom.state.objects[itemId1];
                item2Match = updatedRedisRoom.state.objects[itemId2];
                item3Match = updatedRedisRoom.state.objects[itemId3];
                expect(item1Match).to.be.an('undefined');
                expect(item2Match).to.be.an('undefined');
                expect(item3Match).to.not.be.an('undefined');
                expect(item3Match.props).to.eql(item3.props);
                shutdown();
              } catch (error) {
                shutdown(error);
              }
            }, 500);
          } catch (error) {
            shutdown(error);
          }
        }, 50);
      }
    }
    try {
      socket = await setupWebsocketAndRoom({
        room: roomname,
        username: `${roomname}_user`,
        userId: Date.now(),
        device: 'browser',
        onmessage: onMessage,
      });
    } catch (error) { reject(error); }
  })).timeout(heartbeatInterval * 3);
  it(`Should join two users to a room and have one of them create a disposable object.
  Then, this person should leave and we should verify that a valid room state update message is sent out.`,
  () => new Promise(async (resolve, reject) => {
    const roomname = 'join_two_create_object_leave_one';
    const uname1 = `${roomname}_user_1`;
    const uid1 = Date.now();
    const uname2 = `${roomname}_user_2`;
    const uid2 = uid1 + 1234;
    const device = 'browser';
    const disposableObjId = 98912;
    const disposableObj = createRandomRoomObject(true, true, true);
    disposableObj.id = disposableObjId;
    let socket1 = null;
    let socket2 = null;
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
        // Leave the first user and then we'll hopefully get a correct state update message
        // about the disposable object being destroyed
        socket1.close();
        socket1 = null;
      } else if (data.msgType === RoomEvents.RoomStateUpdate) {
        try {
          expect(data.data).to.not.be.an('undefined');
          expect(data.data).to.not.be.a('null');
          expect(data.data.delete[0]).to.equal(disposableObjId);
          done();
        } catch (error) { done(error); }
      }
    }
    async function onMessage1({ data }) {
      if (data.msgType === SocketEvents.RoomJoined) {
        const update = new SocketMessage({
          data: new StateUpdate({
            create: [disposableObj],
          }),
          msgType: RoomEvents.RoomStateUpdate,
        });
        socket1.send(update.toWire());
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
    } catch (error) { done(error); }
  })).timeout(heartbeatInterval * 3);
});
