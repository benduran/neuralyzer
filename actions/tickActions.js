
const config = require('../config');
const logger = require('../logger');

const { Tick } = require('../actionTypes');

/**
 * Removes the latest function to be executed from the tick queue and processes it
 */
function dequeue() {
  return (dispatch, getState) => {
    const { queue } = getState().tick;
    const queueLen = queue.length;
    for (let i = 0; i < queueLen; i++) {
      try {
        queue[i]();
      } catch (error) { logger.error(error); }
      dispatch({ type: Tick.Dequeue });
    }
  };
}

/**
 * Pushes a function to execute onto the tick queue
 * @param {Function} fnc - Actions to enqueue
 */
function enqueue(fnc) {
  return { type: Tick.Enqueue, fnc };
}

/**
 * Starts the tick queue running at the tick interval specified in the config.server.tickRate property.
 */
function startTicker() {
  return (dispatch, getState) => {
    if (!getState().tick.ticking) {
      logger.info(`Starting ticker. Dequeues will happen every ${config.server.tickRate}ms.`);
      dispatch({
        type: Tick.StartTicker,
        tickIntervalHandler: setInterval(() => dispatch(dequeue()), config.server.tickRate),
      });
    }
  };
}

/**
 * Stops the tick queue ticker.
 */
function stopTicker() {
  return (dispatch, getState) => {
    const { tick } = getState();
    if (tick.ticking && tick.tickIntervalHandler) {
      clearInterval(tick.tickIntervalHandler);
      dispatch({ type: Tick.StopTicker });
    }
  };
}

exports.startTicker = startTicker;
exports.stopTicker = stopTicker;
exports.enqueue = enqueue;
exports.dequeue = dequeue;
