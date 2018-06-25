
/* globals describe it before after */
const { promisify } = require('util');

const { expect } = require('chai');
const uuid = require('uuid/v4');

const config = require('../config');
const { setupWebsocketAndRoom, setupWebsocket, getServerState } = require('./util');
const { SocketEvents } = require('../constants');
const RedisClient = require('../redisClient');
const { SocketMessage } = require('../models');

const {
  server: {
    sockets: {
      heartbeatInterval,
      heartbeatMissedThreshold,
    },
  },
} = config;

describe('Reconnect tests', () => {
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
    'Should connect one client, disconnect them from the server, then reconnect before the heartbeat threshold has been exceeded.',
    () => new Promise(async (resolve, reject) => {
      let socket1 = null;
      let socket2 = null;
      const roomname = 'client_connect_disconnect_connect_again';
      const uname = `${roomname}_user`;
      const uid = uuid();
      const device = 'browser';
      let pulseCount = 0;
      let shouldReconnect = true;
      let sid = null;
      let stopProcessing = false;
      function done(error) {
        if (socket1) socket1.close();
        if (socket2) socket2.close();
        setTimeout(() => {
          if (error) return reject(error);
          return resolve();
        }, 200);
      }
      async function onmessageReconnect({ data }) {
        // Data will still be in a flatbuffer format, so we need to parse it out.
        const parsed = SocketMessage.fromWire(data);
        if (parsed.msgType === SocketEvents.Pulse) return socket2.send(new SocketMessage({ msgType: SocketEvents.Blip }).toWire());
        if (!stopProcessing && parsed.msgType === SocketEvents.RoomJoined) {
          stopProcessing = true;
          const redisroom = JSON.parse(await getAsync(await getAsync(redisClient.getRedisRoomAliasKey(roomname))));
          const serverState = await getServerState();
          const room = Object.values(serverState.rooms).find(r => r.name === roomname);
          expect(redisroom).to.not.be.a('null');
          expect(room).to.not.be.an('undefined');
          expect(room.participants.filter(r => r.name === uname).length).to.equal(1);
          expect(redisroom.participants.filter(r => r.name === uname).length).to.equal(1);
          expect(serverState.connections.length).to.equal(1);
          return done();
        }
        return undefined;
      }
      async function onmessage({ data }) {
        if (data.msgType === SocketEvents.Pulse) pulseCount++;
        else if (data.msgType === SocketEvents.ConnectionReady) {
          // The socket.sid should have been sent over this message.
          sid = data.data;
        }
        if (shouldReconnect && pulseCount >= (heartbeatMissedThreshold - 1)) {
          // Try to connect a different socket with the socket sid from the first connection.
          // We're going to "fake" a reconnect this way.
          shouldReconnect = false;
          // Rejoining plain here with an sid in the query will make the server automatically connect to the last room we were in.
          socket2 = await setupWebsocket(onmessageReconnect, 0, undefined, `sid=${sid}`);
        }
      }
      try {
        socket1 = await setupWebsocketAndRoom({
          room: roomname,
          username: uname,
          userId: uid,
          allowPulse: true,
          onmessage,
          device,
        });
      } catch (error) { done(error); }
    }),
  ).timeout(heartbeatInterval * (heartbeatMissedThreshold + 5)); // Give the test some extra time to finish off
});
