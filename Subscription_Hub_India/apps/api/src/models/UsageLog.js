import mongoose from 'mongoose';

const usageLogSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  subscriptionId: { type: String, required: true, index: true },
  source: { type: String, enum: ['manual', 'browser', 'spotify', 'demo'], default: 'manual' },
  hours: { type: Number, min: 0, max: 10000, required: true },
  cost: { type: Number, min: 0, max: 1000000, default: 0 },
  recordedAt: { type: Date, default: Date.now }
}, { timestamps: true });

usageLogSchema.index({ userId: 1, subscriptionId: 1, recordedAt: -1 });
export default mongoose.models.UsageLog || mongoose.model('UsageLog', usageLogSchema);
