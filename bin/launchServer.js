/* eslint-disable global-require */
/* eslint-disable no-console */
const program = require('commander');

async function launchServer({ port, hostname, redisHost, redisPassword, flatBuffers, disableServerLogs }) {
  // Usually we don't do non-global require, but we don't
  // want the server to import the config until we've mapped it.
  if (port) process.env.NEURALYZER_SERVER_PORT = port.toString();
  if (hostname) process.env.NEURALYZER_SERVER_HOSTNAME = hostname;
  if (redisHost) process.env.NEURALYZER_REDIS_HOST = redisHost;
  if (redisPassword) process.env.NEURALYZER_REDIS_PASSWORD = redisPassword;
  if (flatBuffers) process.env.NEURALYZER_FLAT_BUFFERS_ENABLED = 'true';
  if (disableServerLogs) process.env.DISABLE_LOGGING = 'yes';
  const { setup: startServer } = require('../server');
  console.log(`Flatbuffers are ${process.env.NEURALYZER_FLAT_BUFFERS_ENABLED === 'true' ? 'enabled' : 'disabled'}`);
  if (process.env.NEURALYZER_SERVER_HOSTNAME) console.log(`SERVER_HOSTNAME is "${process.env.NEURALYZER_SERVER_HOSTNAME}"`);
  if (process.env.NEURALYZER_SERVER_PORT) console.log(`SERVER_PORT is "${process.env.NEURALYZER_SERVER_PORT}"`);
  if (process.env.NEURALYZER_REDIS_HOST) console.log(`REDIS_HOST is "${process.env.NEURALYZER_REDIS_HOST}"`);
  await startServer();
}

/**
 * Sets up the commander command for launching the server.
 * If no commander program instance is provided, the one required in this module is used instead.
 * @param {Commander} cmder - Commander program instance
 */
function setupLaunchServerCommand(cmder = program) {
  cmder
    .command('serve')
    .option('-d, --disableLogs', 'If set, disables Winston logging for the server.')
    .option('-f, --flatBuffers', 'If set, tests the networking communications using the Flat Buffers schema.')
    .option('-p, --port <port>', '(Optional) Port override for the server')
    .option('-h, --hostname <hostname>', '(Optional) Hostname override for the server')
    .option('--redishost <redisHost>', '(Optional) Redis host override')
    .option('--redispass <redisPassword>', '(Optional) Redis password override')
    .description('Launches the Neuralyzer server.')
    .action(options => launchServer({ ...cmder, ...options }));
  return cmder;
}

module.exports = setupLaunchServerCommand;

if (!module.parent) {
  if (process.argv.length >= 3) {
    setupLaunchServerCommand();
    program.parse(process.argv);
  } else program.help();
}
