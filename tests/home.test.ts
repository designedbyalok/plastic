import { describe, expect, it } from 'vitest';
import { fileHref, parseRoute } from '../src/app/router';
import { editedAgo } from '../src/home/time';
import { parseScale } from '../src/panels/inspector/StyleSections';

describe('routes', () => {
  it('parses home and file routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/file/demo')).toEqual({ name: 'file', id: 'demo' });
    expect(parseRoute('/file/demo/')).toEqual({ name: 'file', id: 'demo' });
    expect(parseRoute('/somewhere/else')).toEqual({ name: 'home' });
  });

  it('round-trips ids through hrefs', () => {
    expect(parseRoute(fileHref('my file'))).toEqual({ name: 'file', id: 'my file' });
  });
});

describe('editedAgo', () => {
  const now = Date.UTC(2026, 9, 2, 12);
  const ago = (seconds: number) => editedAgo(now - seconds * 1000, now);

  it('matches the home screen wording', () => {
    expect(ago(5)).toBe('Edited just now');
    expect(ago(60)).toBe('Edited 1 minute ago');
    expect(ago(3600)).toBe('Edited 1 hour ago');
    expect(ago(9 * 86400)).toBe('Edited 9 days ago');
    expect(ago(173 * 86400)).toBe('Edited 173 days ago');
    expect(ago(400 * 86400)).toBe('Edited 1 year ago');
  });

  it('never says "in the future" for clock skew', () => {
    expect(editedAgo(now + 5000, now)).toBe('Edited just now');
  });
});


describe('parseScale', () => {
  it('treats unset scale as identity (flip must not collapse to 0)', () => {
    expect(parseScale('')).toEqual([1, 1]);
    expect(parseScale('none')).toEqual([1, 1]);
    expect(parseScale('2')).toEqual([2, 2]);
    expect(parseScale('-1 1')).toEqual([-1, 1]);
  });
});
