
exports.DeviceType = require('./deviceType');

/**
 * Returns the checked value if it exists within the enum, or null if it isn't found.
 * @param {Object} enumeration - Enum
 * @param {String|Number} val - Value to check if exists in the enum
 */
function coerce(enumeration, val) {
  for (const key in enumeration) { // eslint-disable-line
    if (enumeration[key] === val) return val;
  }
  return null;
}

/**
 * Does a reverse lookup of a value inside an enumeration and returns the value's string name.
 * @param {Object} enumeration - Enum
 * @param {String|Number} val - Value to reverse lookup the string key name.
 */
function getString(enumeration, val) {
  for (const key in enumeration) {
    if (enumeration[key] === val) return key;
  }
  return null;
}

exports.getString = getString;
exports.coerce = coerce;
