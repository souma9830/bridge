const mongoose = require('mongoose');

const CursorSchema = new mongoose.Schema({
  streamIdentifier: { type: String, unique: true }, // e.g., "account_G..."
  pagingToken: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Cursor', CursorSchema);
