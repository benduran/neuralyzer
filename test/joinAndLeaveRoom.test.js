
/* globals describe it before after */
const { promisify } = require('util');

const { expect } = require('chai');
const uuid = require('uuid/v4');

const config = require('../config');
const { setupWebsocketAndRoom, getServerState } = require('./util');
const { SocketEvents, RoomEvents } = require('../constants');
const RedisClient = require('../redisClient');

const { heartbeatInterval } = config.server.sockets;

describe('Join & Leave room tests', () => {
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
  it(
    'One user should create room, join it, leave and verify the room has been closed. Room should also not exist in Redis anymore.',
    () => new Promise(async (resolve, reject) => {
      const roomName = 'test_join_leave_room';
      const username = 'test_join_leave_user';
      const userId = Date.now().toString();
      const device = 'browser';
      const redisRoomname = redisClient.getRedisRoomAliasKey(roomName);
      let socket = null;
      async function onmessage({ data }) {
        if (data.msgType === RoomEvents.RoomCreated) {
          let { rooms } = await getServerState();
          const roomBeforeClose = rooms[Object.keys(rooms).find(rid => rooms[rid].name === roomName)];
          socket.close();
          // After closing the socket, wait a bit before checking the state, just in case
          setTimeout(async () => {
            try {
              rooms = (await getServerState()).rooms; // eslint-disable-line
              const roomMatch = rooms[Object.keys(rooms).find(rid => rooms[rid].name === roomName)];
              const redisRoomKey = await getAsync(redisRoomname);
              const oopsieRoom = await getAsync(roomName);
              expect(redisRoomKey).to.be.a('null');
              expect(roomBeforeClose).to.not.be.an('undefined');
              expect(Object.keys(roomBeforeClose)).to.not.be.empty; // eslint-disable-line
              expect(roomMatch).to.be.an('undefined');
              expect(oopsieRoom).to.be.a('null');
              resolve();
            } catch (error) { reject(error); }
          }, 200);
        }
      }
      socket = await setupWebsocketAndRoom({
        room: roomName,
        username,
        userId,
        device,
        onmessage,
      });
    }),
  ).timeout(heartbeatInterval * 2);
  it(
    'Two users should join. Verify that local state and Redis state are synchronized with each other.',
    () => new Promise(async (resolve, reject) => {
      const roomName = 'test_duo_join_leave_room';
      const uname1 = 'duo_join_leave_user_1';
      const uname2 = 'duo_join_leave_user_2';
      const uid1 = Date.now();
      const uid2 = uid1 + 1000;
      const device = 'browser';
      const redisAliasKey = redisClient.getRedisRoomAliasKey(roomName);
      let usocket1 = null;
      let usocket2 = null;
      function shutdown(err) {
        usocket1.close();
        usocket2.close();
        setTimeout(() => {
          if (err) return reject(err);
          return resolve();
        }, 200);
      }
      function onMessage1() {
        /* no-op. don't really care here */
      }
      async function onMessage2({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          try {
            const redisRoomname = await getAsync(redisAliasKey);
            const { rooms } = await getServerState();
            const room = rooms[Object.keys(rooms).find(rid => rooms[rid].name === roomName)];
            expect(room.participants.length).to.equal(2);
            expect(room.participants.find(p => p.name === uname1)).to.not.be.an('undefined');
            expect(room.participants.find(p => p.name === uname2)).to.not.be.an('undefined');
            const parsedRoom = JSON.parse(await getAsync(redisRoomname));
            expect(parsedRoom.participants.length).to.equal(2);
            expect(parsedRoom.participants.find(p => p.name === uname1)).to.not.be.an('undefined');
            expect(parsedRoom.participants.find(p => p.name === uname2)).to.not.be.an('undefined');
            // Close out and this should cleanup redis
            shutdown();
          } catch (error) {
            shutdown(error);
          }
        }
        return null;
      }
      try {
        usocket1 = await setupWebsocketAndRoom({
          room: roomName,
          username: uname1,
          userId: uid1,
          onmessage: onMessage1,
          device,
        });
        usocket2 = await setupWebsocketAndRoom({
          room: roomName,
          username: uname2,
          userId: uid2,
          onmessage: onMessage2,
          wait: 100,
          device,
        });
      } catch (error) {
        if (usocket1) usocket1.close();
        if (usocket2) usocket2.close();
        reject(error);
      }
    }),
  ).timeout(heartbeatInterval * 2);
  it(
    `Two users should join at almost the same time and then one should leave.
    Verify that local state and Redis state no longer contain the person that left.`,
    () => new Promise(async (resolve, reject) => {
      let usocket1 = null;
      let usocket2 = null;
      const roomname = 'test_duo_join_at_same_time_room';
      const uid1 = Date.now();
      const uid2 = uid1 + 1000;
      const uname1 = `${roomname}_user_1`;
      const uname2 = `${roomname}_user_2`;
      const device = 'browser';
      let u1ready = false;
      let u2ready = false;
      function shutdown(error) {
        if (usocket1) usocket1.close();
        setTimeout(() => {
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      function checkReady() {
        if (u1ready && u2ready) {
          usocket2.close();
        }
      }
      async function finish() {
        function personFilter(p) { return p.name === uname2; }
        try {
          const redisRoom = await redisClient.getRoom(roomname);
          const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
          expect(redisRoom).to.not.be.a('null');
          expect(room).to.not.be.an('undefined');
          expect(redisRoom.participants.find(personFilter)).to.be.an('undefined');
          expect(room.participants.find(personFilter)).to.be.an('undefined');
          shutdown();
        } catch (error) { shutdown(error); }
      }
      function onMessage1({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          u1ready = true;
          checkReady();
        } else if (data.msgType === RoomEvents.OnLeaveUserFromRoom) finish();
      }
      function onMessage2({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          u2ready = true;
          checkReady();
        }
      }
      try {
        const [s1, s2] = await Promise.all([
          setupWebsocketAndRoom({
            room: roomname,
            username: uname1,
            userId: uid1,
            onmessage: onMessage1,
            device,
          }),
          setupWebsocketAndRoom({
            room: roomname,
            username: uname2,
            userId: uid2,
            onmessage: onMessage2,
            wait: 100,
            device,
          }),
        ]);
        usocket1 = s1;
        usocket2 = s2;
      } catch (error) { shutdown(error); }
    }),
  ).timeout(heartbeatInterval * 2);
  it('Should join a user to a room, leave the room, then join again', () => new Promise(async (resolve, reject) => {
    let socket = null;
    const roomname = 'join_leave_rejoin_room';
    const username = `${roomname}_user`;
    const uid = Date.now().toString();
    const device = 'browser';
    let joinfirst = false;
    function shutdown(error) {
      if (socket) socket.close();
      setTimeout(() => {
        if (error) return reject(error);
        return resolve();
      }, 200);
    }
    async function onmessage({ data }) {
      if (data.msgType === SocketEvents.RoomJoined) {
        if (!joinfirst) {
          joinfirst = true;
          socket.close();
          setTimeout(async () => {
            socket = await setupWebsocketAndRoom({
              room: roomname,
              userId: uid,
              username,
              device,
              onmessage,
            });
          }, 100);
        } else {
          try {
            const redisRoom = await redisClient.getRoom(roomname);
            const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
            const finduser = p => p.id === uid;
            expect(redisRoom).to.not.be.a('null');
            expect(room).to.not.be.an('undefined');
            expect(redisRoom.participants.find(finduser)).to.not.be.an('undefined');
            expect(room.participants.find(finduser)).to.not.be.an('undefined');
            shutdown();
          } catch (error) { shutdown(error); }
        }
      }
    }
    try {
      socket = await setupWebsocketAndRoom({
        room: roomname,
        userId: uid,
        username,
        device,
        onmessage,
      });
    } catch (error) { shutdown(error); }
  })).timeout(heartbeatInterval * 2);
  it('Shoujd join two users to a room, leave one user, then rejoin again with the user that left', () => new Promise(async (resolve, reject) => {
    let socket1 = null;
    let socket2 = null;
    const roomname = 'test_join_leave_join_again_room';
    const uname1 = `${roomname}_user_1`;
    const uname2 = `${roomname}_user_2`;
    const uid1 = Date.now().toString();
    const uid2 = (+uid1 + 1000).toString();
    const device = 'browser';
    let userJoinCount = 0;
    let leftOnce = false;
    function shutdown(error) {
      if (socket1) socket1.close();
      if (socket2) socket2.close();
      setTimeout(() => {
        if (error) return reject(error);
        return resolve();
      }, 200);
    }
    function onMessage1({ data }) {
      if (data.msgType === RoomEvents.OnUserJoinedRoom) userJoinCount++;
    }
    async function onMessage2({ data }) {
      if (data.msgType === SocketEvents.RoomJoined) {
        if (!leftOnce) {
          leftOnce = true;
          socket2.close();
          setTimeout(async () => {
            // Join this socket again
            socket2 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname2,
              userId: uid2,
              onmessage: onMessage2,
              device,
            });
          }, 100);
        } else {
          try {
            const redisRoom = await redisClient.getRoom(roomname);
            const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
            const user2filter = p => p.id === uid2;
            expect(redisRoom).to.not.be.a('null');
            expect(room).to.not.be.an('undefined');
            expect(redisRoom.participants.length).to.equal(2);
            expect(room.participants.length).to.equal(2);
            expect(userJoinCount).to.equal(2);
            expect(redisRoom.participants.find(user2filter)).to.not.be.an('undefined');
            expect(room.participants.find(user2filter)).to.not.be.an('undefined');
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
          device,
        }),
        setupWebsocketAndRoom({
          room: roomname,
          username: uname2,
          userId: uid2,
          onmessage: onMessage2,
          wait: 100,
          device,
        }),
      ]);
      socket1 = s1;
      socket2 = s2;
    } catch (error) { shutdown(error); }
  })).timeout(heartbeatInterval * 2);
  it('Should connect a user and verify that their device type is marked as a "browser."', () => new Promise(async (resolve, reject) => {
    const roomname = 'join_user_device_type_room';
    const redisRoomname = redisClient.getRedisRoomAliasKey(roomname);
    const uname = `${roomname}_user`;
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
        try {
          const redisRoom = await getAsync(redisRoomname);
          const room = Object.values((await getServerState()).rooms).find(r => r.name === roomname);
          expect(redisRoom).to.not.be.a('null');
          expect(room).to.not.be.an('undefined');
          const pMatch = room.participants.find(p => p.id === uid);
          expect(pMatch).to.not.be.an('undefined');
          expect(pMatch.device).to.equal(device);
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
  })).timeout(heartbeatInterval * 2);
});
