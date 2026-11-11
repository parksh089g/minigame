import { describe, expect, it } from 'vitest';
import {
  GEM_CHAIN_MS,
  GEM_GAP_MS,
  GEM_STEPS,
  gemNote,
  MIN_GAP_MS,
  SoundBoard,
  SOUNDS,
  type Note,
  type SoundId,
} from './sound';

const IDS = Object.keys(SOUNDS) as SoundId[];
/** 소리 하나가 처음부터 끝까지 걸리는 시간(초) */
const lengthOf = (notes: readonly Note[]): number => Math.max(...notes.map((n) => (n.at ?? 0) + n.d));

describe('효과음의 값', () => {
  it('모든 음이 들리는 범위 안에 있고 너무 크지 않다', () => {
    for (const id of IDS) {
      const notes = SOUNDS[id];
      expect(notes.length, id).toBeGreaterThan(0);
      for (const note of notes) {
        for (const f of [note.f, note.to ?? note.f]) {
          expect(f, id).toBeGreaterThanOrEqual(40);
          expect(f, id).toBeLessThanOrEqual(4200);
        }
        expect(note.d, id).toBeGreaterThan(0);
        expect(note.d, id).toBeLessThanOrEqual(0.8);
        expect(note.v ?? 0.3, id).toBeGreaterThan(0);
        expect(note.v ?? 0.3, id).toBeLessThanOrEqual(0.4);
        expect(note.at ?? 0, id).toBeGreaterThanOrEqual(0);
      }
      expect(lengthOf(notes), id).toBeLessThanOrEqual(1.4);
    }
  });

  it('자주 나는 소리는 짧고 작다', () => {
    for (const id of ['kill', 'strike', 'bolt', 'volley'] as const) {
      expect(lengthOf(SOUNDS[id]), id).toBeLessThanOrEqual(0.12);
      for (const note of SOUNDS[id]) expect(note.v ?? 0.3, id).toBeLessThanOrEqual(0.26);
      expect(MIN_GAP_MS[id], id).toBeGreaterThanOrEqual(80);
    }
    const gem = gemNote(0);
    expect(gem.d).toBeLessThanOrEqual(0.06);
    expect(gem.v ?? 0.3).toBeLessThanOrEqual(0.26);
  });

  it('한 번에 울리는 음을 다 더해도 지나치게 크지 않다', () => {
    // 같은 순간에 겹쳐 울리는 음의 크기를 더한다.
    for (const id of IDS) {
      const notes = SOUNDS[id];
      for (const note of notes) {
        const start = note.at ?? 0;
        const together = notes
          .filter((other) => (other.at ?? 0) <= start && start < (other.at ?? 0) + other.d)
          .reduce((sum, other) => sum + (other.v ?? 0.3), 0);
        expect(together, id).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('새벽 소리는 올라가며 끝나고, 꺼지는 소리는 내려가며 끝난다', () => {
    const first = (id: SoundId): number => SOUNDS[id][0].f;
    const clearTop = Math.max(...SOUNDS.clear.map((n) => n.f));
    expect(clearTop).toBeGreaterThan(first('clear'));
    const deathLow = Math.min(...SOUNDS.death.map((n) => n.to ?? n.f));
    expect(deathLow).toBeLessThan(first('death'));
  });
});

describe('빛 조각 줍는 소리', () => {
  it('이어서 주울수록 음이 올라가다가 멈춘다', () => {
    let last = 0;
    for (let step = 0; step < GEM_STEPS; step += 1) {
      const { f } = gemNote(step);
      expect(f).toBeGreaterThan(last);
      last = f;
    }
    expect(gemNote(GEM_STEPS + 20).f).toBe(last);
    expect(gemNote(-3).f).toBe(gemNote(0).f);
  });

  it('잠깐 쉬면 처음 음으로 돌아가고, 너무 바로 이어지는 것은 건너뛴다', () => {
    const played: Note[] = [];
    const board = new SoundBoard((note) => played.push(note));
    expect(board.gem(1000)).toBe(true);
    expect(board.gem(1000 + GEM_GAP_MS - 1)).toBe(false);
    expect(board.gem(1100)).toBe(true);
    expect(board.gem(1200)).toBe(true);
    expect(played.map((n) => n.f)).toEqual([gemNote(0).f, gemNote(1).f, gemNote(2).f]);
    // 한참 뒤에 주우면 다시 처음부터
    expect(board.gem(1200 + GEM_CHAIN_MS + 1)).toBe(true);
    expect(played[3].f).toBe(gemNote(0).f);
  });

  it('아무리 많이 주워도 맨 위 음에서 멈춘다', () => {
    const played: Note[] = [];
    const board = new SoundBoard((note) => played.push(note));
    for (let i = 0; i < 40; i += 1) board.gem(i * 100);
    expect(played).toHaveLength(40);
    expect(played[39].f).toBe(gemNote(GEM_STEPS - 1).f);
  });
});

describe('소리판', () => {
  it('소리에 적힌 음을 모두 내보낸다', () => {
    const played: Note[] = [];
    const board = new SoundBoard((note) => played.push(note));
    expect(board.play('clear', 0)).toBe(true);
    expect(played).toEqual([...SOUNDS.clear]);
  });

  it('늦춰서 내면 모든 음이 그만큼 뒤로 밀린다', () => {
    const played: Note[] = [];
    const board = new SoundBoard((note) => played.push(note));
    board.play('death', 0, 0.2);
    expect(played.map((n) => n.at)).toEqual(SOUNDS.death.map((n) => (n.at ?? 0) + 0.2));
    // 원래 값은 건드리지 않는다.
    expect(SOUNDS.death[0].at ?? 0).toBe(0);
  });

  it('몰려서 나는 소리는 간격을 두고, 다른 소리끼리는 막지 않는다', () => {
    const played: Note[] = [];
    const board = new SoundBoard((note) => played.push(note));
    const gap = MIN_GAP_MS.kill ?? 0;
    expect(board.play('kill', 500)).toBe(true);
    expect(board.play('kill', 500 + gap - 1)).toBe(false);
    expect(board.play('strike', 500 + gap - 1)).toBe(true);
    expect(board.play('kill', 500 + gap)).toBe(true);
    expect(played).toHaveLength(SOUNDS.kill.length * 2 + SOUNDS.strike.length);
  });

  it('간격이 적혀 있지 않은 소리는 부를 때마다 난다', () => {
    let count = 0;
    const board = new SoundBoard(() => {
      count += 1;
    });
    expect(MIN_GAP_MS.hurt).toBeUndefined();
    board.play('hurt', 10);
    board.play('hurt', 10);
    expect(count).toBe(SOUNDS.hurt.length * 2);
  });
});
