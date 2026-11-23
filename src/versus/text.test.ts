import { describe, expect, it } from 'vitest';
import { readSavedRoom } from './saved-room';
import { shortName, withSubject } from './text';

describe('이름 다듬기', () => {
  it('받침에 따라 이/가를 고른다', () => {
    expect(withSubject('민수')).toBe('민수가');
    expect(withSubject('지원')).toBe('지원이');
    expect(withSubject('2P')).toBe('2P가');
    expect(withSubject('1P')).toBe('1P가');
    expect(withSubject('Sam')).toBe('Sam이');
    expect(withSubject('player7')).toBe('player7이');
  });

  it('긴 이름은 줄인다', () => {
    expect(shortName('가나다', 6)).toBe('가나다');
    expect(shortName('가나다라마바사', 6)).toBe('가나다라마…');
  });
});

describe('들어가 있던 방', () => {
  const now = 1_800_000_000_000;
  const token = 'ab'.repeat(16);
  it('30분이 안 된 방만 돌아갈 수 있다', () => {
    expect(readSavedRoom({ game: 'hula', code: 'ABCDEF', token, at: now - 1000 }, now)).toEqual({ game: 'hula', code: 'ABCDEF', token, at: now - 1000 });
    expect(readSavedRoom({ game: 'hula', code: 'ABCDEF', token, at: now - 31 * 60 * 1000 }, now)).toBeNull();
    expect(readSavedRoom({ game: 'chess', code: 'ABCDEF', token, at: now }, now)).toBeNull();
    expect(readSavedRoom({ game: 'hula', code: 'ABC', token, at: now }, now)).toBeNull();
    expect(readSavedRoom(null, now)).toBeNull();
  });
});
