
const http = require('http');

const config = require('../../config');

function getServerState(portOverride) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      host: '127.0.0.1',
      port: portOverride || config.server.port,
      path: '/api/server/state',
      headers: {
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = null;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.on('data', (chunk) => {
          if (!data) data = chunk;
          else data += chunk;
        });
        res.on('error', reject);
        res.on('end', () => resolve(JSON.parse(data.toString('utf8'))));
      }
    });
    req.end();
  });
}

module.exports = getServerState;
