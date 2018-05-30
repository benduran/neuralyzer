# Neuralyzer
Node.js, Websocket-based simple state synchronization server. Useful for synchronizing simple games and collaborative visualizations.

## Setup and Installation
1. Make sure you have [Nodejs](https://nodejs.org/en/), version 8 or greater installed.
2. `npm install`
3. Install Redis on your local machine, either standalone or via Docker. Make sure it is listening on the default **6379** port.

## Commands
- `npm run server:start` - Starts Neuralyzer and listens on port 80
- `npm run test` - Runs unit tests that test connectivity and room state updates
