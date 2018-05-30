
const { RoomObject } = require('../../models');

const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_LEN = 6;

let objId = 0;

function getRandomStr(len) {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += possible.substr(Math.floor(Math.random() * possible.length), 1);
  }
  return str;
}

/**
 * Creates a random, shallow object for testing.
 * @param {Number} keys - Number of keys to create on the random object
 * @return {Object} Random created object
 */
function createRandomObject(keys) {
  const out = {};
  for (let i = 0; i < keys; i++) {
    out[getRandomStr(MAX_LEN)] = getRandomStr(MAX_LEN);
  }
  return out;
}

/**
 * Creates a random object that matches the RoomObject schema.
 * Useful for testing objects that are backed by the Flat Buffer schema.
 * @returns {RoomObject} Random Room Object.
 */
function createRandomRoomObject(
  disposable = false,
  hasPosition = Math.floor(Math.random() * 2),
  hasPrefab = Math.floor(Math.random() * 2),
  isHidden = false,
  hasName = true,
) {
  const ro = new RoomObject(objId++, {}, '', disposable, hasName ? getRandomStr(MAX_LEN) : null);
  if (hasPosition) {
    ro.props.position = {
      x: Math.ceil(Math.random() * 360),
      y: Math.ceil(Math.random() * 360),
      z: Math.ceil(Math.random() * 360),
    };
  }
  if (hasPrefab) ro.props.prefab = `${getRandomStr(MAX_LEN)}.prefab`;
  ro.props.isHidden = isHidden;
  return ro;
}

exports.createRandomObject = createRandomObject;
exports.createRandomRoomObject = createRandomRoomObject;
