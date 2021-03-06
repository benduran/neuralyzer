/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */

const path = require('path');

/**
 * Imports a JavaScript Neuralyzer class by first checking
 * whether the user provided a custom model (in the userDefined folder),
 * or if the user is using the default model that came with Neuralyzer
 * @param {String} modelName - Name of schema to be imported. This must match the case of the filename.
 * @returns {Object} Schema
 */
function importModel(modelName) {
  if (!modelName) throw new Error('No modelName was provided when importing a Neuralyzer model.');
  try {
    const root = process.env.NEURALYZER_USER_MODELS_PATH || path.join(__dirname, 'userDefined');
    return require(path.join(root, `${modelName}.js`));
  } catch (error) {
    // Try default schema and throw uncaught exception if it's not found
    return require(path.join(__dirname, `${modelName}.js`));
  }
}

module.exports = importModel;
