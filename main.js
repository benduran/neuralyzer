/* eslint-disable global-require */
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { promisify } = require('util');

const program = require('commander');

const setupLauncherServerCommand = require('./bin/launchServer');

async function cleanZips() {
  const glob = require('glob');
  const globAsync = promisify(glob);
  const unlinkAsync = promisify(fs.unlink);
  const zips = await globAsync('./*.zip', { nodir: true });
  await Promise.all(zips.map(z => new Promise(async (resolve, reject) => {
    try {
      await unlinkAsync(z);
      resolve();
    } catch (error) { reject(error); }
  })));
}

function createZipArchive() {
  return new Promise(async (resolve, reject) => {
    const glob = require('glob');
    const { ZipFile } = require('yazl');
    const md5 = require('md5');
    const globAsync = promisify(glob);
    await cleanZips();
    const archive = new ZipFile();
    const filesToCopy = [
      './actions/*',
      './actionTypes/*',
      './config/index.js',
      './config/config.defaults.js',
      './constants/*',
      './middleware/*',
      './enum/*',
      './logger/*',
      './models/**/*',
      './redisClient/*',
      './reducers/*',
      './store/*',
      './staleRoomCleaner/*',
      './util/*',
      './routes/*',
      './flatbuffer/**/*.*',
      '.dockerignore',
      'Dockerfile',
      'Dockerrun.aws.json',
      'server.js',
      'main.js',
      'package-lock.json',
      'package.json',
    ];
    Promise.all(filesToCopy.map(pattern => new Promise(async (archiveResolve, archiveReject) => {
      try {
        const matches = await globAsync(pattern, { nodir: true });
        if (matches.length) {
          return matches.forEach((p) => {
            const normalized = path.normalize(p);
            archive.addFile(normalized, normalized);
            archiveResolve();
          });
        }
        return archiveResolve();
      } catch (error) { return archiveReject(error); }
    }))).then(() => {
      const outFilename = path.join(__dirname, './Neuralyer.archive.zip');
      const writeStream = fs.createWriteStream(outFilename);
      archive.outputStream.once('end', () => {
        fs.readFile(outFilename, (readError, buff) => {
          if (readError) return reject(readError);
          return fs.rename(outFilename, `${outFilename.replace(/\.zip$/, '')}.${md5(buff)}.zip`, (renameError) => {
            if (renameError) return reject(renameError);
            return resolve();
          });
        });
      });
      archive.outputStream.pipe(writeStream);
      archive.end();
    }).catch((error) => {
      console.error(error); // eslint-disable-line
      reject(error);
    });
  });
}

function performTests({ enableServerLogs, flatBuffers }) {
  return new Promise(async (resolve) => {
    // Starts the local server, runs the tests, then closes the server
    try {
      if (flatBuffers) {
        console.info('Using flat buffers for data transmission');
        process.env.FLAT_BUFFERS_ENABLED = 'true';
      }
      process.env.NEURALYZER_NODE_ENV = 'test';
      process.env.DISABLE_LOGGING = enableServerLogs ? 'no' : 'yes';
      const Mocha = require('mocha');
      const glob = require('glob');
      const globAsync = promisify(glob);
      const mocha = new Mocha();
      const testFiles = (await globAsync('./test/*.test.js', { nodir: true })).filter(f => f.indexOf('multiserver') === -1);
      testFiles.forEach(fp => mocha.addFile(fp));
      const { setup: setupServer } = require('./server');
      const { httpListener } = await setupServer();
      const runner = mocha.run();
      let testError = null;
      runner.on('end', () => {
        httpListener.close();
        if (testError) console.error(testError.err);
        resolve();
      });
      runner.on('fail', (error) => {
        testError = error;
      });
    } catch (error) {
      console.error(error);
      resolve();
    }
  });
}

function performMultiServerTests({ enableServerLogs }) {
  return new Promise(async (resolve) => {
    try {
      process.env.NEURALYZER_NODE_ENV = 'test';
      process.env.DISABLE_LOGGING = enableServerLogs ? 'no' : 'yes';
      const Mocha = require('mocha');
      const glob = require('glob');
      const globAsync = promisify(glob);
      const mocha = new Mocha();
      const testFiles = (await globAsync('./test/*.test.js', { nodir: true })).filter(f => f.indexOf('multiserver') > -1);
      testFiles.forEach(fp => mocha.addFile(fp));
      // We will let these super-specific multi-server tests setup their own server instances,
      // as we don't know how many instances to spawn here.
      const runner = mocha.run();
      let testError = null;
      runner.on('end', () => {
        if (testError) console.error(testError);
        resolve();
      });
      runner.on('fail', (error) => { testError = error; });
    } catch (error) {
      console.error(error);
      resolve();
    }
  });
}

function performAllTests(options) {
  return new Promise((resolve, reject) => {
    performTests(options).then(() => {
      setTimeout(() => {
        // Delay an extra second to give things time to cleanup
        console.info('Pausing for a moment to allow ample time for server processes to cleanup between test runs.');
        performMultiServerTests(options).then(resolve).catch(reject);
      }, 2000);
    }).catch(reject);
  });
}

async function performFlatBufferBuild(options) {
  try {
    if (!/win32/.test(process.platform)) throw new Error('Unable to compile flatbuffer schema on a non-Windows platform. Please compile and provide schema manually.');
    const { lang = 'js' } = options;
    if (!lang) throw new Error('Cannot compile flatbuffer schema because no language was provided.');
    const globAsync = promisify(require('glob'));
    const statAsync = promisify(fs.stat);
    const flatcBinary = (await globAsync(path.join(__dirname, 'flatbuffer/flatc.*')))[0]; // Assume it's the first one
    const out = path.join(__dirname, 'flatbuffer');
    const allSchemaFiles = await globAsync(path.join(__dirname, 'flatbuffer/schema/*.fbs'));
    if (!(await statAsync(flatcBinary)).isFile()) throw new Error('Cannot compile flatbuffer schema because flatc binary was not found.');
    await allSchemaFiles.map(f => new Promise((resolve) => {
      const args = [
        `--${lang}`,
        '--gen-onefile',
        '--gen-all',
        '-o',
        out,
        f,
      ];
      console.info(`\nExecuting ${flatcBinary} ${args.join(' ')}\n`);
      const child = spawn(flatcBinary, args, { stdio: 'inherit' });
      // Let all exit correctly and assume the user will just read the console output themselves to figure it out
      child.once('exit', resolve);
    }));
  } catch (error) { console.error(error); }
}

async function handleArgsAndExecute(options, fnc, onDone) {
  onDone = onDone || function () {}; // eslint-disable-line
  try {
    if (!fnc) throw new Error('Unable to process command.');
    console.log(`Executing ${typeof options.name === 'function' ? options.name() : options._name}.`);
    await fnc({ ...program, ...options });
    await onDone();
  } catch (error) { onDone(error); }
}

function mapDefaultOptions(command) {
  // TODO: Put shared CLI options here
  return command;
}

function mapDefaultTestOptions(command) {
  return command
    .option('-e, --enableServerLogs', 'If set, enables Winston logging for the server.')
    .option('-f, --flatBuffers', 'If set, tests the networking communications using the Flat Buffers schema.');
}

mapDefaultOptions(
  program
    .command('zip')
    .description('Zips up the project and prepares it for deployment.'),
).action(options => handleArgsAndExecute(options, createZipArchive));

mapDefaultOptions(setupLauncherServerCommand(program));

mapDefaultTestOptions(
  program
    .command('test')
    .description('Runs the series of unit and functional tests'),
).action(options => handleArgsAndExecute(options, performTests, () => process.exit(0)));

mapDefaultTestOptions(
  program
    .command('testmulti')
    .description('Runs multi-server configuration test scenarios to ensure state remains synchronized between multiple instances.'),
).action(options => handleArgsAndExecute(options, performMultiServerTests, () => process.exit(0)));

mapDefaultTestOptions(
  program
    .command('testall')
    .description('Runs all tests contained within the Neuralyzer project'),
).action(options => handleArgsAndExecute(options, performAllTests, () => process.exit(0)));

mapDefaultOptions(
  program.command('flatbuffer')
    .option('-l, --lang <lang>', 'Target language for flat buffer schema compilation.', 'js')
    .description(`
    Compiles all flatbuffer schemas to the desired target language using flatc binary.
    Assumes binary in contained within the flatbuffer folder.
    `),
).action(options => handleArgsAndExecute(options, performFlatBufferBuild, () => process.exit(0)));

if (process.argv.length >= 3) {
  program.parse(process.argv);
} else program.help();
