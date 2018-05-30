
/* globals describe it before after */
const path = require('path');
const { promisify } = require('util');
const { spawn } = require('child_process');

const { expect } = require('chai');

const config = require('../config');
const { StateUpdate, SocketMessage } = require('../models');
const { createRandomRoomObject, setupWebsocketAndRoom, getServerState } = require('./util');
const { objects } = require('../util');
const RedisClient = require('../redisClient');
const { SocketEvents, RoomEvents } = require('../constants');

const { heartbeatInterval } = config.server.sockets;

const pathToMain = path.join(__dirname, '../main.js');

describe('Multi server', () => {
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
    redisClient.close().then(() => {
      getAsync = null;
      done();
    });
  });
  it('Should start two servers and verify that they are both listening for connections.', () => new Promise(async (resolve, reject) => {
    let serverProc1 = null;
    let serverProc2 = null;
    function done(error) {
      if (serverProc1) serverProc1.kill();
      if (serverProc2) serverProc2.kill();
      setTimeout(() => {
        if (error) return reject(error);
        return resolve();
      }, 200);
    }
    // First server will use the default config that's checked into the project
    try {
      serverProc1 = spawn('node', [pathToMain, 'serve']);
      serverProc2 = spawn('node', [pathToMain, 'serve', '-p', '8082']);
      const state1 = await getServerState();
      const state2 = await getServerState();
      expect(state1).to.not.be.an('undefined');
      expect(state2).to.not.be.an('undefined');
      done();
    } catch (error) { done(error); }
  }));
  it('Should start two servers and connect one user to one of them. Verify both servers have the same local state and redis also matches.',
    () => new Promise(async (resolve, reject) => {
      let serverProc1 = null;
      let serverProc2 = null;
      let socket = null;
      const roomname = 'multi_server_simple';
      const redisRoomname = redisClient.getRedisRoomAliasKey(roomname);
      const uname = `${roomname}_user`;
      const uid = Date.now();
      const device = 'browser';
      function done(error) {
        if (socket) socket.close();
        setTimeout(() => {
          if (serverProc1) serverProc1.kill();
          if (serverProc2) serverProc2.kill();
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      async function onMessage({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          // Let's do the testing here
          try {
            const { rooms: server1Rooms } = await getServerState();
            const { rooms: server2Rooms } = await getServerState(8082);
            const redisRoomKey = await getAsync(redisRoomname);
            const redisRoom = await getAsync(redisRoomKey);
            const server1RoomMatch = Object.values(server1Rooms).find(r => r.name === roomname);
            expect(server1Rooms).to.not.be.an('undefined');
            expect(server2Rooms).to.not.be.an('undefined');
            expect(server1RoomMatch).to.not.be.an('undefined');
            expect(server1Rooms).to.eql(server2Rooms);
            expect(server1RoomMatch).to.eql(JSON.parse(redisRoom));
            done();
          } catch (error) { done(error); }
        }
      }
      try {
        serverProc1 = spawn('node', [pathToMain, 'serve']);
        serverProc2 = spawn('node', [pathToMain, 'serve', '-p', '8082']);
        socket = await setupWebsocketAndRoom({
          room: roomname,
          username: uname,
          userId: uid,
          onmessage: onMessage,
          device,
        });
      } catch (error) { done(error); }
    })).timeout(heartbeatInterval * 2);
  it(
    'Should start ten servers, connect two users, each to a different server, and then verify all states and redis are synchronized.',
    () => new Promise(async (resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      const serverProcesses = [];
      const roomname1 = 'multi_server_many';
      const redisRoomname1 = redisClient.getRedisRoomAliasKey(roomname1);
      const roomname2 = 'multi_server_many_room_2';
      const redisRoomname2 = redisClient.getRedisRoomAliasKey(roomname2);
      const uname1 = `${roomname1}_user_1`;
      const uid1 = Date.now();
      const uname2 = `${roomname2}_user_2`;
      const uid2 = uid1 + 1000;
      const device = 'browser';
      let u1ready = false;
      let u2ready = false;
      function done(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        setTimeout(() => {
          serverProcesses.forEach(p => p.kill());
          // Kinda gross, but it gives time for all of the server processes to shutdown correctly before moving to the next test
          setTimeout(() => {
            if (error) return reject(error);
            return resolve();
          }, 1000);
        }, 200);
      }
      async function ready() {
        if (u1ready && u2ready) {
          // Let's get to testing, beyotch
          try {
            u1ready = false;
            u2ready = false;
            const redisRoom1 = JSON.parse(await getAsync(await getAsync(redisRoomname1)));
            const redisRoom2 = JSON.parse(await getAsync(await getAsync(redisRoomname2)));
            expect(redisRoom1).to.not.be.a('null');
            expect(redisRoom2).to.not.be.a('null');
            expect(redisRoom1.participants.find(p => p.name === uname1)).to.not.be.an('undefined');
            expect(redisRoom2.participants.find(p => p.name === uname2)).to.not.be.an('undefined');
            let allStates = await Promise.all(serverProcesses.map(async (p, i) => getServerState(config.server.port + i)));
            allStates = allStates.map(s => objects.omit(s, 'connections'));
            const firstServerState = allStates[0];
            const firstServerStateRoom1 = Object.values(firstServerState.rooms).find(r => r.name === roomname1);
            const firstServerStateRoom2 = Object.values(firstServerState.rooms).find(r => r.name === roomname2);
            expect(Object.keys(firstServerState.rooms).length).to.equal(2);
            expect(firstServerStateRoom1.participants.some(p => p.name === uname1)).to.be.ok; // eslint-disable-line
            expect(firstServerStateRoom2.participants.some(p => p.name === uname2)).to.be.ok; // eslint-disable-line
            expect(firstServerStateRoom1).to.eql(redisRoom1);
            expect(firstServerStateRoom2).to.eql(redisRoom2);
            allStates.slice(1).forEach(state => expect(state).to.eql(firstServerState));
            done();
          } catch (error) { done(error); }
        }
      }
      function onMessage1({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          u1ready = true;
        }
        ready();
      }
      function onMessage2({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          u2ready = true;
        }
        ready();
      }
      try {
        // Start all the servers
        for (let i = 0; i < 10; i++) {
          serverProcesses.push(spawn('node', [pathToMain, 'serve', '-p', (config.server.port + i).toString()]));
        }
        setTimeout(async () => {
          try {
            const [s1, s2] = await Promise.all([
              setupWebsocketAndRoom({
                room: roomname1,
                username: uname1,
                userId: uid1,
                onmessage: onMessage1,
                device,
              }),
              setupWebsocketAndRoom({
                room: roomname2,
                username: uname2,
                userId: uid2,
                onmessage: onMessage2,
                wait: 0,
                allowPulse: false,
                port: config.server.port + 3,
                device,
              }),
            ]);
            socket1 = s1;
            socket2 = s2;
          } catch (error) { done(error); }
        }, 3000);
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * 10);
  it(
    `Should start 10 servers, then have a user create a room.
    Another user will then attempt to join the created room, but on a different server than the first user.
    Verify that all the servers and redis are synchronized.
    First user should also receive a notification that the 2nd user has joined the room,
    event though they are on a different server.`,
    () => new Promise((resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      const serverProcesses = [];
      const roomname = 'test_multi_same_room';
      const uname1 = `${roomname}_user_1`;
      const uid1 = Date.now();
      const uname2 = `${roomname}_user_2`;
      const uid2 = uid1 + 1000;
      const device = 'browser';
      function done(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        setTimeout(() => {
          serverProcesses.forEach(p => p.kill());
          setTimeout(() => {
            if (error) return reject(error);
            return resolve();
          }, 1000);
        }, 200);
      }
      async function onMessage1({ data }) {
        if (data.msgType === RoomEvents.OnUserJoinedRoom) {
          // Do the testing
          try {
            const redisRoom = JSON.parse(await getAsync((await getAsync(redisClient.getRedisRoomAliasKey(roomname)))));
            let allStates = await Promise.all(serverProcesses.map((p, i) => getServerState(config.server.port + i)));
            allStates = allStates.map(s => objects.omit(s, 'connections'));
            const firstState = allStates[0];
            const roomMatch = Object.values(firstState.rooms).find(r => r.name === roomname);
            expect(data.data).to.equal(uname2);
            expect(roomMatch).to.not.be.an('undefined');
            expect(redisRoom).to.not.be.a('null');
            expect(roomMatch.participants.find(p => p.id === uid1.toString())).to.not.be.an('undefined');
            expect(roomMatch.participants.find(p => p.id === uid2.toString())).to.not.be.an('undefined');
            expect(roomMatch).to.eql(redisRoom);
            allStates.slice(1).forEach(r => expect(r).to.eql(firstState));
            done();
          } catch (error) { done(error); }
        }
      }
      function onMessage2() {
        /* no-op here */
      }
      try {
        for (let i = 0; i < 10; i++) {
          serverProcesses.push(spawn('node', [pathToMain, 'serve', '-p', (config.server.port + i).toString()]));
        }
        // Add a delay to when the connections are attempted, as all the node processes need some time to startup
        setTimeout(async () => {
          try {
            socket1 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname1,
              userId: uid1,
              onmessage: onMessage1,
              device,
            });
            socket2 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname2,
              userId: uid2,
              onmessage: onMessage2,
              wait: 250,
              allowPulse: false,
              port: config.server.port + 2,
              device,
            });
          } catch (error) { done(error); }
        }, 2000);
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * 10);

  it.only(
    `Should start 8 servers and connect 3 users, each to a different server.
    Then, two of the users will perform state updates.
    Verify users recieve the correct state update messages,
    and that the server and redis states are synchronized.`,
    () => new Promise((resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      let socket3 = null;
      const serverProcesses = [];
      const roomname = 'test_multi_same_room_state_update';
      const uname1 = `${roomname}_user_1`;
      const uid1 = Date.now();
      const uname2 = `${roomname}_user_2`;
      const uid2 = uid1 + 1000;
      const uname3 = `${roomname}_user_3`;
      const uid3 = uid2 + 1000;
      const device = 'browser';
      const objId1 = 189231290;
      const objId2 = 9032912;
      const obj1 = createRandomRoomObject(false, true, true);
      obj1.id = objId1;
      const obj2 = createRandomRoomObject(false, true, true);
      obj2.id = objId2;
      function done(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        if (socket3) socket3.close();
        setTimeout(() => {
          serverProcesses.forEach(p => p.kill());
          setTimeout(() => {
            if (error) return reject(error);
            return resolve();
          }, 1000);
        }, 200);
      }
      let stateUpdateCount = 0;
      let socket3SentMessage = false;
      let socket2SendMessage = false;
      async function ready() {
        if (socket2SendMessage && stateUpdateCount === 4) {
          // Start the testing here
          try {
            const redisRoom = JSON.parse(await getAsync(await getAsync(redisClient.getRedisRoomAliasKey(roomname))));
            let allStates = await Promise.all(serverProcesses.map((p, i) => getServerState(config.server.port + i)));
            allStates = allStates.map(s => objects.omit(s, 'connections'));
            const firstState = allStates[0];
            const roomMatch = Object.values(firstState.rooms).find(r => r.name === roomname);
            expect(roomMatch).to.not.be.an('undefined');
            expect(redisRoom).to.not.be.a('null');
            expect(redisRoom).to.eql(roomMatch);
            expect(roomMatch.participants.some(p => p.id === uid1.toString())).to.be.ok; // eslint-disable-line
            expect(roomMatch.participants.some(p => p.id === uid2.toString())).to.be.ok; // eslint-disable-line
            expect(roomMatch.participants.some(p => p.id === uid3.toString())).to.be.ok; // eslint-disable-line
            expect(Object.keys(roomMatch.state.objects).length).to.equal(2);
            expect(roomMatch.state.objects[obj1.id].props).to.eql(obj1.props);
            expect(roomMatch.state.objects[obj2.id].props).to.eql(obj2.props);
            allStates.slice(1).forEach(s => expect(s).to.eql(firstState));
            done();
          } catch (error) { done(error); }
        }
      }
      function onMessage1({ data }) {
        if (data.msgType === RoomEvents.RoomStateUpdate) {
          stateUpdateCount++;
          ready();
        }
      }
      function onMessage2({ data }) {
        if (data.msgType === RoomEvents.RoomStateUpdate) {
          stateUpdateCount++;
          // Send out an update to one of the objects contained within
          if (socket3SentMessage) {
            socket3SentMessage = false;
            socket2SendMessage = true;
            obj1.props.position.y = 888;
            const update = new StateUpdate({
              update: [obj1],
            });
            socket2.send(new SocketMessage({ msgType: RoomEvents.RoomStateUpdate, data: update }).toWire());
          }
        }
      }
      function onMessage3({ data }) {
        if (data.msgType === SocketEvents.RoomJoined) {
          // Send a state update
          socket3SentMessage = true;
          const update = new StateUpdate({
            create: [obj1, obj2],
          });
          socket3.send(new SocketMessage({ msgType: RoomEvents.RoomStateUpdate, data: update }).toWire());
        } else if (data.msgType === RoomEvents.RoomStateUpdate) {
          stateUpdateCount++;
          ready();
        }
      }
      try {
        for (let i = 0; i < 8; i++) {
          serverProcesses.push(spawn('node', [pathToMain, 'serve', '-p', (config.server.port + i).toString()]));
        }
        setTimeout(async () => {
          try {
            socket1 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname1,
              userId: uid1,
              onmessage: onMessage1,
              device,
            });
            socket2 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname2,
              userId: uid2,
              port: config.server.port + 2,
              onmessage: onMessage2,
              wait: 0,
              allowPulse: false,
              device,
            });
            socket3 = await setupWebsocketAndRoom({
              room: roomname,
              username: uname3,
              userId: uid3,
              onmessage: onMessage3,
              wait: 0,
              allowPulse: false,
              port: config.server.port + 5,
              device,
            });
          } catch (error) { done(error); }
        }, 2000);
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * 8);
});
