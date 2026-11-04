import test from 'node:test';
import assert from 'node:assert/strict';
import {indiaDay,indiaMonthBounds} from './indiaTime.js';
test('India day and month roll over at 18:30 UTC',()=>{
 assert.equal(indiaDay('2026-10-31T19:00:00Z').toISOString(),'2026-11-01T00:00:00.000Z');
 assert.equal(new Date(indiaMonthBounds(new Date('2026-10-31T19:00:00Z'))[0]).toISOString(),'2026-10-31T18:30:00.000Z');
});
