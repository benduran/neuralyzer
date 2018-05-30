
/**
 * Takes an object and returns a new object with properties removed.
 * @param {Object} obj - Object to transform into new object with properties omitted.
 * @param {...String} propsToOmit - Properties to exclude.
 */
function omit(obj, ...propsToOmit) {
  const out = {};
  for (const prop in obj) {
    if (!propsToOmit.some(p => p === prop)) out[prop] = obj[prop];
  }
  return out;
}

/**
 * Takes an object and returns a new object with only the specified properties.
 * @param {Object} obj - Object to transform into new object with only certain properties.
 * @param {...String} propsToPick - Properties to include
 */
function pick(obj, ...propsToPick) {
  const out = {};
  for (const prop in obj) {
    if (propsToPick.some(p => p === prop)) out[prop] = obj[prop];
  }
  return out;
}

exports.omit = omit;
exports.pick = pick;
