
const { createStore, combineReducers, applyMiddleware } = require('redux');
const thunk = require('redux-thunk');

const allReducers = require('../reducers');

const store = createStore(combineReducers(allReducers), applyMiddleware(thunk.default));

module.exports = store;
