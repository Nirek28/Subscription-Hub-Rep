import mongoose from 'mongoose';
import { repositoryMode } from '../services/repository.js';
const schema = new mongoose.Schema({ _id: String, userId: { type: String, index: true }, data: mongoose.Schema.Types.Mixed });
const State = mongoose.models.ExtensionState || mongoose.model('ExtensionState', schema);
const usageSchema = new mongoose.Schema({ _id: String, userId: { type: String, index: true }, subscriptionId: String, deviceId: String, source: { type: String, default: 'browser' }, hours: Number, cost: { type: Number, default: 0 }, recordedAt: Date, receivedAt: Date });
const Usage = mongoose.models.BrowserUsage || mongoose.model('BrowserUsage', usageSchema);
const memory = new Map(), usage = new Map();
export const mongo = () => repositoryMode() === 'mongo';
export async function put(id, userId, data) {
  if (mongo()) await State.updateOne({ _id: id }, { $set: { userId, data } }, { upsert: true });
  else memory.set(id, structuredClone({ _id: id, userId, data }));
}
export async function get(id) { return mongo() ? State.findById(id).lean() : structuredClone(memory.get(id)); }
export async function take(id) {
  if (mongo()) return State.findOneAndDelete({ _id: id }).lean();
  const row = memory.get(id); memory.delete(id); return structuredClone(row);
}
export async function rows(userId, prefix) {
  const all = mongo() ? await State.find({ userId }).lean() : [...memory.values()].filter(x => x.userId === userId);
  return all.filter(x => x._id.startsWith(prefix));
}
export async function remove(id) { if (mongo()) await State.deleteOne({ _id: id }); else memory.delete(id); }
export async function saveUsage(row) {
  if (mongo()) { try { await Usage.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true }); } catch (e) { if (e.code !== 11000) throw e; } }
  else if (!usage.has(row._id)) usage.set(row._id, structuredClone(row));
}
export async function browserUsage(userId) {
  return mongo() ? Usage.find({ userId }).lean() : structuredClone([...usage.values()].filter(x => x.userId === userId));
}
export async function deleteUsage(userId) {
  if (mongo()) await Usage.deleteMany({ userId });
  else for (const [id, row] of usage) if (row.userId === userId) usage.delete(id);
}
export async function touch(id) {
  if (mongo()) await State.updateOne({ _id:id }, { $set:{ 'data.lastSync':Date.now() } });
  else { const row=memory.get(id); if(row) row.data.lastSync=Date.now(); }
}
