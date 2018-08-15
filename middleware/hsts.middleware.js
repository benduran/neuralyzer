
const { server: { ssl: sslConfig } } = require('../config');

/**
 * If HSTS is enabled,
 * this middleware applies the HSTS headers to each inbound to this Neuralyzer instance.
 * @returns {Function} Middleware
 */
function hstsMiddleware() {
  return (req, res, next) => {
    res.set('strict-transport-security', `max-age=${sslConfig.hstsMaxAge};${sslConfig.hstsIncludeSubdomains ? ' includeSubdomains' : ''}`);
    next();
  };
}

module.exports = hstsMiddleware;
