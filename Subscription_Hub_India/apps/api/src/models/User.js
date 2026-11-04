import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  emailVerified: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 0 },
  resetTokenHash: { type: String, select: false },
  resetExpires: Date,
  verifyTokenHash: { type: String, select: false },
  verifyExpires: Date,
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', userSchema);
