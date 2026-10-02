import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/document/factory';
import { setTitle } from '../src/document/ops';
import { EMPTY_HISTORY, record, redo, undo } from '../src/editor/history';

const snap = (title: string) => ({ doc: setTitle(emptyDocument(), title), selection: [], label: '' });

describe('history', () => {
  it('undoes and redoes', () => {
    const h1 = record(EMPTY_HISTORY, snap('a'), null, 0);
    const undone = undo(h1, snap('b'))!;
    expect(undone.snapshot.doc.title).toBe('a');
    const redone = redo(undone.history, undone.snapshot)!;
    expect(redone.snapshot.doc.title).toBe('b');
  });

  it('coalesces edits with the same key in a short window', () => {
    let h = record(EMPTY_HISTORY, snap('a'), 'css:x:padding', 0);
    h = record(h, snap('ab'), 'css:x:padding', 300);
    h = record(h, snap('abc'), 'css:x:padding', 600);
    expect(h.past).toHaveLength(1);
    h = record(h, snap('abcd'), 'css:x:gap', 700);
    expect(h.past).toHaveLength(2);
    h = record(h, snap('abcde'), 'css:x:gap', 5000);
    expect(h.past).toHaveLength(3);
  });

  it('clears redo on a new edit', () => {
    const h = record(EMPTY_HISTORY, snap('a'), null, 0);
    const undone = undo(h, snap('b'))!;
    expect(record(undone.history, snap('a'), null, 1).future).toHaveLength(0);
  });
});
