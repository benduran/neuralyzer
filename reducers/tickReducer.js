
const { Tick } = require('../actionTypes');

const defaultState = {
  ticking: false,
  tickIntervalHandler: null,
  queue: [],
};

function tickReducer(state = defaultState, action) {
  switch (action.type) {
    case Tick.Enqueue:
      return {
        ...state,
        queue: state.queue.concat([action.fnc]) };
    case Tick.Dequeue:
      return {
        ...state,
        queue: state.queue.slice(1),
      };
    case Tick.StartTicker:
      return {
        ...state,
        ticking: true,
        tickIntervalHandler: action.tickIntervalHandler,
      };
    case Tick.StopTicker:
      return defaultState;
    default:
      return state;
  }
}

module.exports = tickReducer;
