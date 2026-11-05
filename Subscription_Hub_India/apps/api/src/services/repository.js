import { browserUsage } from '../extension/store.js';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import UsageLog from '../models/UsageLog.js';


let memoryUsers = [];
let memorySubscriptions = [];
let memoryUsage = [];

let usingMongo = false;

export async function initializeRepository() {
  if (!process.env.MONGO_URI) { if (process.env.NODE_ENV === 'production') throw new Error('MONGO_URI required in production'); return 'memory'; }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    usingMongo = true;
    return 'mongo';
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn(`MongoDB unavailable; using volatile demo storage (${error.message})`);
    return 'memory';
  }
}

export const repositoryMode = () => usingMongo ? 'mongo' : 'memory';
const safeUser = (user) => user ? ({ id: String(user._id || user.id), name: user.name, email: user.email, emailVerified: !!user.emailVerified, sessionVersion: user.sessionVersion || 0 }) : null;

export async function createUser({ name, email, passwordHash }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (usingMongo) {
    try {
      const user = await User.create({ _id: randomUUID(), name: name.trim(), email: normalizedEmail, passwordHash });
      return safeUser(user);
    } catch (error) {
      if (error?.code === 11000) return null;
      throw error;
    }
  }
  if (memoryUsers.some((user) => user.email === normalizedEmail)) return null;
  const user = { id: randomUUID(), name: name.trim(), email: normalizedEmail, passwordHash, createdAt: new Date() };
  memoryUsers.push(user);
  return safeUser(user);
}

export async function findUserByEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (usingMongo) {
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash').lean();
    return user ? { ...safeUser(user), passwordHash: user.passwordHash } : null;
  }
  const user = memoryUsers.find((item) => item.email === normalizedEmail);
  return user ? structuredClone(user) : null;
}

export async function findUserById(id) {
  if (usingMongo) {
    const user = await User.findById(id).lean();
    return safeUser(user);
  }
  return safeUser(memoryUsers.find((item) => item.id === id));
}

export async function listSubscriptions(userId) {
  if (usingMongo) return (await Subscription.find({ userId }).lean()).map((x) => ({ ...x, id: String(x._id) }));
  return structuredClone(memorySubscriptions.filter((x) => x.userId === userId));
}
export async function listAllActiveSubscriptions() {
  if (usingMongo) return (await Subscription.find({ status: 'active' }).lean()).map((x) => ({ ...x, id: String(x._id) }));
  return structuredClone(memorySubscriptions.filter((x) => x.status === 'active'));
}
export async function getSubscription(id, userId) {
  if (usingMongo) { const x = await Subscription.findOne({ _id: id, userId }).lean(); return x ? { ...x, id: String(x._id) } : null; }
  return structuredClone(memorySubscriptions.find((x) => x.id === id && x.userId === userId) || null);
}
export async function saveSubscription(record, userId) {
  if (usingMongo) {
    const { id, ...data } = record;
    const x = await Subscription.findOneAndUpdate({ _id: id, userId }, data, { new: true, runValidators: true }).lean();
    return x ? { ...x, id: String(x._id) } : null;
  }
  const index = memorySubscriptions.findIndex((x) => x.id === record.id && x.userId === userId);
  if (index < 0) return null;
  memorySubscriptions[index] = structuredClone({ ...record, userId });
  return structuredClone(memorySubscriptions[index]);
}
export async function addSubscription(record, userId) {
  const next = { id: record.id || `sub-${randomUUID()}`, userId, status: 'active', ...record };
  if (usingMongo) {
    const { id, ...data } = next;
    const x = await Subscription.create({ _id: id, ...data });
    return { ...x.toObject(), id: String(x._id) };
  }
  memorySubscriptions.push(structuredClone(next));
  return structuredClone(next);
}
async function listBaseUsage(userId) {
  if (usingMongo) return (await UsageLog.find({ userId }).lean()).map((x) => ({ ...x, id: String(x._id) }));
  return structuredClone(memoryUsage.filter((x) => x.userId === userId));
}
export async function addUsage(record, userId) {
  const next = { id: randomUUID(), userId, recordedAt: new Date(), ...record };
  if (usingMongo) { const { id, ...data } = next; const x = await UsageLog.create({ _id: id, ...data }); return { ...x.toObject(), id: String(x._id) }; }
  memoryUsage.push(structuredClone(next));
  return structuredClone(next);
}

// Token checks and user updates happen in one atomic database operation.
export async function saveAccountToken(userId, purpose, tokenHash, expires) {
  const fields = purpose === 'reset' ? { resetTokenHash: tokenHash, resetExpires: expires } : { verifyTokenHash: tokenHash, verifyExpires: expires };
  if (usingMongo) return User.updateOne({ _id: userId }, { $set: fields });
  const user = memoryUsers.find(u => u.id === userId);
  if (user) Object.assign(user, fields);
}
export async function consumeAccountToken(purpose, tokenHash, passwordHash, now = new Date()) {
  const tokenField = purpose === 'reset' ? 'resetTokenHash' : 'verifyTokenHash';
  const expiresField = purpose === 'reset' ? 'resetExpires' : 'verifyExpires';
  const set = purpose === 'reset' ? { passwordHash } : { emailVerified: true };
  if (usingMongo) {
    const update = { $set: set, $unset: { [tokenField]: '', [expiresField]: '' } };
    if (purpose === 'reset') update.$inc = { sessionVersion: 1 };
    return safeUser(await User.findOneAndUpdate({ [tokenField]: tokenHash, [expiresField]: { $gt: now } }, update, { new: true }));
  }
  const user = memoryUsers.find(u => u[tokenField] === tokenHash && u[expiresField] > now);
  if (!user) return null;
  Object.assign(user, set);
  if (purpose === 'reset') user.sessionVersion = (user.sessionVersion || 0) + 1;
  delete user[tokenField]; delete user[expiresField];
  return safeUser(user);
}

// Merge browser events without modifying existing manual/provider usage storage.
export async function listUsage(userId) {
  const [existing, browser] = await Promise.all([listBaseUsage(userId), browserUsage(userId)]);
  return [...existing, ...browser.map(x => ({ ...x, id: String(x._id) }))];
}
