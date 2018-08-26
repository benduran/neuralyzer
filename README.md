# Documentation updates are in-progress and are coming soon!

# Neuralyzer
Node.js, Websocket-based state synchronization server. Useful for synchronizing multiplayer games and collaborative visualizations. Backed by Redis for synchronizing state between multiple instances. Also uses Redis as a Pub/Sub channel for synchronizing multiple executing servers. Originally created for use at NASA Jet Propulsion Laboratory for synchronizing Mars rover visualizations.

## Setup and Installation
- Make sure you have [Node JS](https://nodejs.org/en/), version 8 or greater installed.
- Choose from one of the following ways to get up and running with Neuralyzer
  - **From a Node application**
    - `npm install neuralyzer --save`
    - Add some code:
      ```
      const { setup: setupNeuralyzer } = require('neuralyzer');
      const { httpListener } = setupNeuralyzer();
      ```

  - **Clone of the repository**
    - After clone, `npm install` if you're planning on running the tests or doing some development within the cloned repo
    - `npm install --production` if you just want to run Neuralyzer
    - `node server.js` to start with default settings

## Configuration
First, we will go over the various configuration options that are _not_ related to the format of the messages sent out over the wire from the server to the clients (and vice-versa).

All of **Neuralyzer's** configuration options can be set through some form of environment variable. These environment variables are mapped, at runtime, by Neuralyzer, and a reusable configuration object is shared throughout the application. All **Neuralyzer-specific** environment variables have the format `NEURALYZER_<VARIABLE_NAME>`, where `NEURALYZER_` is the prefix for the environment variable.

### Available Variables
- `NEURALYZER_SERVER_ID` - Unique ID of the server. If not provided, a `uuid/v4` is generated at runtime. This is primarily used for filtering messages received over the pub/sub Redis channel.
- `NEURALYZER_SERVER_PORT` - Port that Neuralyzer will use for listening to connections. Defaults to `8081`.
- `NEURALYZER_SERVER_HOSTNAME` - Hostname that Neuralyzer will attempt to bind to when listening for connections. Defaults to `0.0.0.0`.
- `NEURALYZER_SOCKET_PATH` - URL path that will be used for clients when connecting to Neuralyzer. Defaults to `/live`.
- `NEURALYZER_HEARTBEAT_INTERVAL` - The duration, in milliseconds, between heartbeats that are sent to clients to check if they are still alive. Defaults to `5000`.
- `NEURALYZER_HEARTBEAT_MISSED_THRESHOLD` - The number of heartbeats that a client is allowed to miss before they are forceably disconnected from Neuralyzer and removed from any rooms in which they are participating. Defaults to `3`.
- `NEURALYZER_TICK_RATE` - The duration, in milliseconds, between outbound queue executions. Essentially, how frequently (in milliseconds) the server will loop through its queue and send messages out to connected clients. Defaults to `50` (*20Hz*).
- `NEURALYZER_SSL_ENABLED` - Whether or not Neuralyzer will create an HTTPS listener for serving secured connections. Defaults to `false`.
- `NEURALYZER_HSTS_ENABLED` - Whether or not the server will write out the HSTS (HTTP Strict Transport Security) header for SSL connections. Defaults to `false`.
- `NEURALYZER_HSTS_INCLUDE_SUBDOMAINS` - Whether or not to enforce HSTS for all subdomains. Defaults to `false`.
- `NEURALYZER_HSTS_MAX_AGE` - Max time HSTS should be enforced by a client / browser. Defaults to `31536000` (in seconds).
- `NEURALYZER_SSL_CERT` - Absolute path to the SSL Certificate to use for the HTTPS listener. Defaults to `''`.
- `NEURALYZER_SSL_KEY` - Absolute path to the SSL Private Key to use for the HTTPS listener. Defaults to `''`.
- `NEURALYZER_SSL_CA` - Absolute path to the SSL Certificate Authority key for the HTTPS listener. Defaults to `''`.
- `NEURALYZER_REDIS_HOST` - Hostname for the Redis instance to use for state synchronization, as well as Pub / Sub. Defaults to `127.0.0.1`.
- `NEURALYZER_REDIS_PORT` - Port for the Redis instance to use for state synchronization, as well as Pub / Sub. Defaults to `6379`.
- `NEURALYZER_REDIS_PASSWORD` - Authentication password for connecting to Redis, if your instance is protected by a password. Defaults to `null`.
- `NEURALYZER_LOG_UNCAUGHT_EXCEPTIONS` - Whether or not Neuralyzer should attempt to catch uncaught exceptions or Promise rejections for its current Node process. Defaults to `false`.
- `NEURALYZER_CONSOLE_LOGGER_ENABLED` - Whether or not Neuralyzer should log `info`, `warn` or `error` statements to the console. Uses [Winston](https://www.npmjs.com/package/winston). Defaults to `false`.
- `NEURALYZER_CONSOLE_LOG_LEVEL` - What log levels will be routed to the console logger (if it is enabled). Defaults to `verbose`.
- `NEURALYZER_S3_LOGGER_ENABLED` - (EXPERIMENTAL. USE AT YOUR OWN RISK) - A logger that writes out a log file to an AWS S3 bucket. Defaults to `false`.
- `NEURALYZER_S3_ACCESS_KEY_ID` - AWS Access Key Id for S3 write permissions. Defaults to `''`.
- `NEURALYZER_S3_SECRET_ACCESS_KEY` - AWS Secret Access Key for S3 write permissions. Defaults to `''`.
- `NEURALYZER_S3_LOG_BUCKET` - AWS bucket to which the log file will be written. Defaults to `''`.
- `NEURALYZER_S3_LOG_LEVEL` - What log levels will be routed to the S3 logger. Defaults to `verbose`.
- `NEURALYZER_S3_LOG_FILENAME` - What filename will be used for the S3 log file. Defaults to `neuralyzer.log`.
- `NEURALYZER_FLAT_BUFFERS_ENABLED` - Whether or not the Flat Buffer transport protocol will be used to compress and byte pack the messages before they are sent to connected clients. Please see the [Flatbuffer](#flatbuffers) section below for more details.
- `NEURALYZER_USER_SCHEMA_PATH` - Absolute path to the folder that contains custom compiled JS flatbuffer schemas. Please see the [FlatBuffers](#flatbuffers) section below for more details.
- `NEURALYZER_USER_MODELS_PATH` - Absolute path to the folder the contains custom JavaScript classes for representing state in Neuralyzer. Please see the [FlatBuffers](#flatbuffers) section below for more details.

## Supported Transport Data Formats (and some comments about their performance)
Neuralyzer supports two over-the-wire data formats out-of-the-box:
- [FlatBuffers](#flatbuffers) (Enabled via the `NEURALYZER_FLAT_BUFFERS_ENABLED` environment variable).
- JSON strings (via built-in `JSON.parse` and `JSON.stringify`).

In simple applications that are more latency-tolerant, using the JSON strings format *may* be sufficient. Neuralyzer's performance will degrade relatively predictably to match known performance issues with `JSON.parse` and `JSON.stringify`, but be aware that the effect can multiply very quickly, depending on your Neuralyzer instance's tick rate and the number of its connected clients. If your application is very sensitive to latency (much like a typical multiplayer PC or Console game), it is recommended to take advantage [FlatBuffers](#flatbuffers). While you lose some flexibility in how you build and represent data in your application, you can easily gain a several orders of magnitude increase in throughput.

## FlatBuffers
- For more information on what a FlatBuffer is, please visit the official [FlatBuffers](https://google.github.io/flatbuffers/) documentation.

## Lifecycle and Events
Neuralyzer has a pretty simple lifecycle for when a WebSocket connects, joins a room, updates state, and leaves a room / closes connection. Each step in the lifecycle is marked by a WebSocket message in the following format:
```
{ msgType: 'Name:Of:Event', data: <String | Object> }
```
The lifecycle of a Neuralyzer client is as follows:
![Neuralyzer Flow Diagram](https://raw.githubusercontent.com/benduran/neuralyzer/master/neuralyzerflow.jpg)

## License
[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)
