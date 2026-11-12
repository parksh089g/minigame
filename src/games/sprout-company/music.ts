/**
 * 새싹 컴퍼니의 배경 음악. 악보를 값으로 적어 두고, 연주는 core/music.ts에 맡긴다.
 * 그래서 이 파일은 브라우저 없이도 테스트할 수 있다. 악보를 적는 법은 core/score.ts에 있다.
 */
import type { Song } from '../../core/score';

/** 화음마다의 낮은 줄: 으뜸음과 다섯째 음을 번갈아 짚는다. */
const BASS = {
  c: 'c3 . . . g3 . . . c3 . . . g3 . e3 .',
  am: 'a2 . . . e3 . . . a2 . . . e3 . c3 .',
  f: 'f2 . . . c3 . . . f2 . . . c3 . a2 .',
  g: 'g2 . . . d3 . . . g2 . . . d3 . b2 .',
  fg: 'f2 . . . c3 . . . g2 . . . d3 . b2 .',
} as const;

/** 박 사이에 가볍게 퉁기는 화음 */
const PLUCK = {
  c: '. . e4 . . . g4 . . . e4 . . . g4 .',
  am: '. . e4 . . . a4 . . . e4 . . . a4 .',
  f: '. . f4 . . . a4 . . . f4 . . . a4 .',
  g: '. . d4 . . . g4 . . . d4 . . . b4 .',
  fg: '. . f4 . . . a4 . . . d4 . . . b4 .',
} as const;

const DRUM = {
  light: 'k...h...k...h...',
  fill: 'k...h...k.h.s.s.',
} as const;

/**
 * 사무실의 아침: 가볍게 통통 튀는 곡. 화음은 C, Am, F, G로 두 번 돌고,
 * 둘째 바퀴에서는 가락이 한 칸 높이 올라갔다가 으뜸음으로 내려와 쉰다.
 */
export const OFFICE_SONG: Song = {
  bpm: 104,
  bars: 8,
  voices: [
    {
      wave: 'triangle',
      volume: 0.3,
      gate: 0.6,
      bars: [BASS.c, BASS.am, BASS.f, BASS.g, BASS.c, BASS.am, BASS.fg, BASS.c],
    },
    {
      wave: 'square',
      volume: 0.06,
      gate: 0.4,
      bars: [PLUCK.c, PLUCK.am, PLUCK.f, PLUCK.g, PLUCK.c, PLUCK.am, PLUCK.fg, PLUCK.c],
    },
    {
      wave: 'triangle',
      volume: 0.26,
      bars: [
        'e5 . g5 . e5 . c5 . d5 . e5 . g5*4',
        'a5 . g5 . e5 . c5 . e5*4 .*4',
        'f5 . a5 . f5 . c5 . d5 . f5 . a5*4',
        'g5 . f5 . d5 . b4 . d5*4 .*4',
        'e5 . g5 . c6 . g5 . e5 . g5 . c6*4',
        'a5 . c6 . a5 . e5 . g5*2 e5*2 c5*4',
        'f5 . a5 . c6 . a5 . g5 . b5 . d6*4',
        'c6*4 g5*2 e5*2 c5*4 .*4',
      ],
    },
  ],
  drums: [DRUM.light, DRUM.light, DRUM.light, DRUM.fill],
  drumVolume: 0.3,
};

export const SONGS = { office: OFFICE_SONG } as const;
