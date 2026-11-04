import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  merchant: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, default: 'Other', maxlength: 40 },
  monthlyCost: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
  renewalDate: { type: Date, required: true },
  cancelUrl: { type: String, default: '' },
  status: { type: String, enum: ['active', 'canceled', 'pending', 'paused', 'completed', 'halted'], default: 'active' },
  provider: { type: String, default: 'manual' },
  providerId: String,
  providerStatus: String,
  billingCycle: String,
  discoveryKey: String,
    uxMultiplier: { type: Number, default: 1, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

subscriptionSchema.index({ userId: 1, status: 1 });
export default mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
