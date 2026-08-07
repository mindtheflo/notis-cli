import assert from 'node:assert/strict';
import test from 'node:test';

import {
  average,
  entryFromDocument,
  eveningComplete,
  gratitudeCount,
  moodStep,
  morningComplete,
  morningStarted,
  sortEntries,
  topMoodWords,
  type JournalEntry,
} from './journal-core';

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'entry',
    title: 'Journal — 2026-07-15',
    date: '2026-07-15',
    morningMood: 6,
    morningMoodWord: 'rested',
    morningFeeling: 'Calm and ready.',
    energy: 8,
    motivation: 9,
    gratitudes: ['Coffee', 'A quiet hour', 'Good sleep'],
    intention: 'One deep-work block.',
    affirmation: 'I am allowed to do one thing at a time.',
    dayMood: 6,
    dayMoodWord: 'satisfying',
    highlight: 'The demo landed.',
    lesson: 'Front-load the scary task.',
    freeEntry: 'A useful reflection.',
    createdAt: '2026-07-15T07:00:00.000Z',
    lastEditedTime: null,
    ...overrides,
  };
}

test('entry adapter preserves normalized journal fields and the free entry', () => {
  const result = entryFromDocument({
    id: 'entry-1',
    title: 'Fallback title',
    properties: {
      Name: 'Journal — 2026-07-15',
      Date: '2026-07-15',
      'Morning Mood': 6,
      'Morning Mood Word': 'rested',
      'Morning Feeling': 'Calm and ready.',
      Energy: 8,
      Motivation: 9,
      'Gratitude 1': 'Coffee',
      'Gratitude 2': 'A quiet hour',
      'Gratitude 3': '  ',
      Intention: 'One deep-work block.',
      Affirmation: 'I am allowed to do one thing at a time.',
      'Day Mood': 7,
      'Day Mood Word': 'unstoppable',
      Highlight: 'The demo landed.',
      Lesson: 'Front-load the scary task.',
    },
    contentMarkdown: 'Protected the morning for deep work.',
  });

  assert.equal(result.title, 'Journal — 2026-07-15');
  assert.equal(result.morningMood, 6);
  assert.equal(result.morningMoodWord, 'rested');
  assert.equal(result.dayMood, 7);
  assert.deepEqual(result.gratitudes, ['Coffee', 'A quiet hour', null]);
  assert.equal(result.freeEntry, 'Protected the morning for deep work.');
});

test('entries sort newest first without mutating the input', () => {
  const original = [entry({ id: 'old', date: '2026-07-12' }), entry({ id: 'new', date: '2026-07-15' })];
  assert.deepEqual(sortEntries(original).map((item) => item.id), ['new', 'old']);
  assert.deepEqual(original.map((item) => item.id), ['old', 'new']);
});

test('mood scale lookup rounds and rejects out-of-range values', () => {
  assert.equal(moodStep(6.4)?.value, 6);
  assert.equal(moodStep(7)?.label, 'Very pleasant');
  assert.equal(moodStep(0), null);
  assert.equal(moodStep(null), null);
});

test('morning completeness requires the full ritual', () => {
  assert.equal(morningComplete(entry()), true);
  assert.equal(morningComplete(entry({ gratitudes: ['Coffee', null, null] })), false);
  assert.equal(morningComplete(entry({ affirmation: null })), false);
  assert.equal(morningStarted(entry({
    morningMood: null,
    morningMoodWord: null,
    morningFeeling: null,
    energy: null,
    motivation: null,
    gratitudes: [null, null, null],
    intention: null,
    affirmation: null,
  })), false);
  assert.equal(gratitudeCount(entry({ gratitudes: ['One', null, 'Three'] })), 2);
});

test('evening completeness requires mood, word, highlight, and lesson', () => {
  assert.equal(eveningComplete(entry()), true);
  assert.equal(eveningComplete(entry({ lesson: null })), false);
  assert.equal(eveningComplete(entry({ dayMood: null })), false);
});

test('metric helpers ignore missing values and count mood words', () => {
  assert.equal(average([8, null, undefined, 6]), 7);
  const words = topMoodWords([
    entry({ morningMoodWord: 'Rested', dayMoodWord: 'rested' }),
    entry({ morningMoodWord: 'foggy', dayMoodWord: null }),
  ]);
  assert.deepEqual(words[0], { word: 'rested', count: 2 });
  assert.deepEqual(words[1], { word: 'foggy', count: 1 });
});
