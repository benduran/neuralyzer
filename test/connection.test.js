
/* globals describe it */
const { expect } = require('chai');

const config = require('../config');
const { setupWebsocket } = require('./util');
const { SocketEvents } = require('../constants');
const { SocketMessage } = require('../models');

const { heartbeatInterval } = config.server.sockets;

describe('WebSocket Connection', () => {
  process.env.NEURALYZER_NODE_ENV = 'test';
  it('Should receive a connection ready message', () => new Promise(async (resolve, reject) => {
    let socket = null;
    function onMessage({ data }) {
      try {
        const parsed = SocketMessage.fromWire(data);
        expect(parsed).to.be.an('object');
        expect(parsed.msgType).to.equal(SocketEvents.ConnectionReady);
        socket.close();
        resolve();
      } catch (error) { reject(error); }
    }
    try {
      socket = await setupWebsocket(onMessage);
    } catch (error) {
      if (socket) socket.close();
      reject(error);
    }
  })).timeout(heartbeatInterval * 2);
  it('Should receive a pulse', () => new Promise(async (resolve, reject) => {
    let socket = null;
    function onMessage({ data }) {
      try {
        const parsed = SocketMessage.fromWire(data);
        if (parsed.msgType === SocketEvents.Pulse) {
          socket.close();
          resolve();
        }
      } catch (error) { reject(error); }
    }
    try {
      socket = await setupWebsocket(onMessage);
    } catch (error) {
      if (socket) socket.close();
      reject(error);
    }
  })).timeout(heartbeatInterval * 2);
});
