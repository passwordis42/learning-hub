import test from 'node:test';
import assert from 'node:assert/strict';
import {
  caveAction, createRogueRooms, judgeCoopAction, lateGenreLabs, runManagement, runRogue, startCave
} from '../docs/genre-labs-20-23.js';

test('management trades material for capacity and the maintenance window', () => {
  const plan = ['expand', 'harvest', 'harvest', 'repair', 'expand', 'harvest'];
  const urgent = runManagement('spike', plan);
  const steady = runManagement('steady', plan);
  assert.equal(urgent.length, 6);
  assert.equal(urgent[0].material, 1);
  assert.equal(urgent[2].demand - urgent[2].serviced, 2);
  assert.equal(urgent[3].disrupted, false);
  assert.equal(steady[2].demand - steady[2].serviced, 0);
  const postponed = runManagement('spike', [...plan.slice(0, 3), 'harvest', 'repair', 'expand']);
  assert.equal(postponed[3].disrupted, true);
  assert.equal(postponed[3].available, 2);
  assert.equal(runManagement('steady', Array(6).fill('expand'))[1].material, 1);
});

test('sandbox tool combinations change ore yields and preserve energy needed for return', () => {
  const act = (tools, battery, actions) => actions.reduce(caveAction, startCave(tools, battery));
  const precision = act(['scanner', 'cutter'], 5, ['scan', 'cut', 'surface']);
  assert.equal(precision.ore, 4);
  assert.equal(precision.battery, 0);
  assert.equal(precision.status, '成功返回');
  const overloaded = act(['scanner', 'cutter'], 5, ['scan', 'cut', 'wade', 'surface']);
  assert.equal(overloaded.status, '搁浅');
  assert.equal(overloaded.log.length, 3);
  assert.equal(overloaded.ore, 4);
  const alternate = act(['cutter', 'tank'], 6, ['cut', 'wade', 'surface']);
  assert.equal(alternate.ore, 5);
  assert.equal(alternate.status, '成功返回');
  const unchecked = startCave(['scanner', 'tank'], 5);
  assert.equal(caveAction(unchecked, 'cut'), unchecked);
});

test('roguelike room offers are reproducible and shared without strategy mutating them', () => {
  const rooms = createRogueRooms(17);
  const original = createRogueRooms(17);
  assert.deepEqual(rooms, original);
  assert.notDeepEqual(createRogueRooms(251), rooms);
  assert.ok(rooms.every((room) => new Set(room.offer.map((item) => item.title)).size === 3));
  const a = runRogue(rooms, 'offence');
  const b = runRogue(rooms, 'defence');
  assert.deepEqual(runRogue(rooms, 'offence'), a);
  assert.notDeepEqual(a, b);
  assert.deepEqual(rooms, original);
  for (const simulation of [a, b]) {
    for (const row of simulation.log) {
      assert.ok(row.reward === '撤退' || rooms[row.room - 1].offer.some((card) => card.title === row.reward));
      assert.ok(row.damage >= 1);
      assert.ok(row.hp >= 0 && row.hp <= 17);
    }
  }
});

test('co-op records the selected mapping and does not confuse symbols with physical controls', () => {
  const room = { target: 2, mapping: [1, 2, 0] };
  assert.deepEqual(judgeCoopAction(room, 1), { pass: true, correctControl: 1 });
  assert.deepEqual(judgeCoopAction(room, 2), { pass: false, correctControl: 1 });
  assert.equal(Object.keys(lateGenreLabs).length, 4);
  assert.ok(Object.values(lateGenreLabs).every(({ title, mount }) => title.trim() && typeof mount === 'function'));
});
