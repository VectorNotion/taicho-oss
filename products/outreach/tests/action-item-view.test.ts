import assert from 'node:assert/strict';
import test from 'node:test';
import { dueLabel, dueTone, groupByDue } from '../domain/action-item-view';

// Fixed clock: Monday 2026-08-10T12:00 local.
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const onDay = (day: number, hour = 9) => new Date(2026, 7, day, hour).toISOString();

test('dueTone classifies by calendar day, not 24h windows', () => {
  assert.equal(dueTone(onDay(9, 23), NOW), 'overdue');   // yesterday evening
  assert.equal(dueTone(onDay(10, 1), NOW), 'today');     // this morning (earlier hour, same day)
  assert.equal(dueTone(onDay(10, 23), NOW), 'today');
  assert.equal(dueTone(onDay(11, 1), NOW), 'upcoming');
});

test('dueLabel wording', () => {
  assert.equal(dueLabel(onDay(9), NOW), 'Overdue · yesterday');
  assert.equal(dueLabel(onDay(8), NOW), 'Overdue · 2 days ago');
  assert.equal(dueLabel(onDay(4), NOW), 'Overdue · 6 days ago');
  assert.equal(dueLabel(onDay(3), NOW), 'Overdue · Aug 3');
  assert.equal(dueLabel(onDay(10), NOW), 'Due today');
  assert.equal(dueLabel(onDay(11), NOW), 'Tomorrow');
  assert.equal(dueLabel(onDay(13), NOW), 'In 3 days');
  assert.equal(dueLabel(onDay(17), NOW), 'Aug 17');
});

test('groupByDue partitions preserving order', () => {
  const items = [
    { id: 'a', dueAt: onDay(8) },
    { id: 'b', dueAt: onDay(9) },
    { id: 'c', dueAt: onDay(10) },
    { id: 'd', dueAt: onDay(12) },
  ];
  const groups = groupByDue(items, NOW);
  assert.deepEqual(groups.overdue.map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(groups.today.map((entry) => entry.id), ['c']);
  assert.deepEqual(groups.upcoming.map((entry) => entry.id), ['d']);
});
