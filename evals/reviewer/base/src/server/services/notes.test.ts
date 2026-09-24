import { describe, expect, it } from 'vitest';
import { saveNote } from '../data/notes.js';
import { getNote } from './notes.js';

describe('getNote', () => {
  // Mutation: drop the owner check in getNote and this goes red.
  it("refuses another owner's note", () => {
    saveNote({ id: 'n1', ownerId: 'alice', body: 'x', archived: false, updatedAt: new Date(0) });
    expect(() => getNote('bob', 'n1')).toThrow('note n1 not found');
  });
});
