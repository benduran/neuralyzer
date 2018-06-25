/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */

const path = require('path');

/**
 * Imports a Flatbuffer schema by first checking
 * whether the user provided a custom schema,
 * or if the user is using the default schema that came with Neuralyzer
 * @param {String} schemaName - Name of schema to be imported. This must match the case of the filename.
 * @returns {Object} Schema
 */
function importSchema(schemaName) {
  if (!schemaName) throw new Error('No schemaName was provided when importing a Flatbuffer schema.');
  try {
    const root = process.env.NEURALYZER_USER_SCHEMA_PATH || path.join(__dirname, 'userDefined');
    return require(path.join(root, `${schemaName}_generated.js`)).Neuralyzer;
  } catch (error) {
    // Try default schema and throw uncaught exception if it's not found
    return require(path.join(__dirname, `${schemaName}_generated.js`)).Neuralyzer;
  }
}

module.exports = importSchema;
