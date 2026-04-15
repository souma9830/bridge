const mongoose = require('mongoose');

const DeadLetterSchema = new mongoose.Schema({
  watchId:    { type: String, required: true, index: true },
  payload:    { type: mongoose.Schema.Types.Mixed, required: true },
  webhookUrl: { type: String, required: true },
  hmacSecret: { type: String, required: true },
  error:      { type: String },
  attempts:   { type: Number, default: 0 },
  maxAttempts:{ type: Number, default: 5 },
  nextRetryAt:{ type: Date, default: Date.now },
  status:     { type: String, enum: ['pending', 'exhausted'], default: 'pending', index: true },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now },
});

DeadLetterSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('DeadLetter', DeadLetterSchema);
