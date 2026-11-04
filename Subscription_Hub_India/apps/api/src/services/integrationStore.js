import mongoose from 'mongoose';
import { repositoryMode } from './repository.js';
const model = mongoose.models.IntegrationRecord || mongoose.model('IntegrationRecord', new mongoose.Schema({
  _id: String, userId: { type: String, index: true }, kind: { type: String, index: true }, data: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, index: { expires: 0 } }
}, { timestamps: true }));
const memory = new Map();
export async function put(kind, id, userId, data, expiresAt) {
  const record = { _id: `${kind}:${id}`, kind, userId, data, ...(expiresAt ? { expiresAt } : {}) };
  if (repositoryMode() === 'mongo') await model.replaceOne({ _id: record._id }, record, { upsert: true });
  else memory.set(record._id, structuredClone(record));
  return data;
}
export async function get(kind, id, userId) {
  const r = repositoryMode() === 'mongo' ? await model.findById(`${kind}:${id}`).lean() : memory.get(`${kind}:${id}`);
  if (!r || (userId !== undefined && r.userId !== userId) || (r.expiresAt && new Date(r.expiresAt) <= new Date())) return null;
  return structuredClone(r.data);
}
export async function list(kind, userId, includeId = false) {
  const rs = repositoryMode() === 'mongo' ? await model.find({kind, userId}).lean() : [...memory.values()].filter(r=>r.kind===kind && r.userId===userId);
  return rs.filter(r=>!r.expiresAt || new Date(r.expiresAt)>new Date()).map(r=>structuredClone(includeId ? {...r.data, recordId:r._id.slice(kind.length+1)} : r.data));
}
export async function remove(kind, id, userId) {
  if (repositoryMode() === 'mongo') await model.deleteOne({_id:`${kind}:${id}`, userId});
  else if (memory.get(`${kind}:${id}`)?.userId === userId) memory.delete(`${kind}:${id}`);
}
const locks = new Map();
export async function locked(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(()=>{}).then(fn); locks.set(key,current);
  try { return await current; } finally { if(locks.get(key)===current) locks.delete(key); }
}
