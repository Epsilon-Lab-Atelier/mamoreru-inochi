import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRILL_DURATIONS,
  DRILL_SCENARIOS,
  completeDrillSession,
  createDrillCalendarIcs,
  createDrillSession,
  drillProgress
} from '../src/drills.js';

test('drills offer 3, 5 and 10 minute options and multiple scenarios', () => {
  assert.deepEqual(DRILL_DURATIONS, [3, 5, 10]);
  assert.ok(DRILL_SCENARIOS.length >= 8);
});

test('drill progress and completion preserve reflection and action item', () => {
  const session = createDrillSession('night-earthquake', 3);
  session.completedSteps = [0, 1];
  session.reflection = '靴が離れていた';
  session.actionItem = '枕元へ靴を置く';
  const progress = drillProgress(session);
  assert.equal(progress.completed, 2);
  assert.ok(progress.total >= 4);
  const completed = completeDrillSession(session);
  assert.equal(completed.reflection, '靴が離れていた');
  assert.equal(completed.actionItem, '枕元へ靴を置く');
  assert.ok(completed.completedAt);
});

test('calendar export creates a valid all-day event without server dependency', () => {
  const ics = createDrillCalendarIcs('2026-09-01');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260901/);
  assert.match(ics, /守れるいのち 防災訓練/);
  assert.throws(() => createDrillCalendarIcs(''), /訓練日/);
});
