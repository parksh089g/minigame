/**
 * 등불지기의 배경 음악. 곡마다 악보를 값으로 적어 두고, 연주는 core/music.ts에 맡긴다.
 * 그래서 이 파일은 브라우저 없이도 테스트할 수 있다. 악보를 적는 법은 core/score.ts에 있다.
 *
 * 준비 화면의 조용한 곡, 스테이지마다 하나씩, 그리고 보스의 곡이 있다.
 * 마지막 보스는 보스의 곡을 더 빠르고 높게 연주한다.
 */
import type { Song, Voice } from '../../core/score';
import type { StageId } from './data';

const REST = '.*16';

/** 네 칸짜리 꼴을 한 마디에 네 번 되풀이한다. */
const four = (cell: string): string => `${cell} ${cell} ${cell} ${cell}`;
/** 같은 마디를 n번 */
const times = (count: number, bar: string): string[] => Array.from({ length: count }, () => bar);

// ------------------------------------------------------------ 준비 화면

/**
 * 등불 아래: 느리고 따뜻하다. 화음을 한 음씩 풀어 내는 가락 위에 긴 음이 얹힌다.
 * 화음은 두 마디씩 C, Am, F, G로 흐르고, 뒤의 여덟 마디는 가락만 조금 높아진다.
 */
const LOBBY_HARMONY = {
  c: 'c4 . g4 . d5 . g4 . e5 . g4 . d5 . g4 .',
  am: 'a3 . e4 . g4 . e4 . c5 . e4 . g4 . e4 .',
  f: 'f3 . c4 . g4 . c4 . a4 . c4 . g4 . c4 .',
  gsus: 'g3 . d4 . g4 . d4 . c5 . d4 . g4 . d4 .',
  g: 'g3 . d4 . g4 . d4 . b4 . d4 . g4 . d4 .',
} as const;

export const LOBBY_SONG: Song = {
  bpm: 84,
  bars: 16,
  voices: [
    {
      wave: 'triangle',
      volume: 0.3,
      soft: true,
      gate: 1,
      bars: ['c3*16', 'c3*16', 'a2*16', 'a2*16', 'f3*16', 'f3*16', 'g3*16', 'g3*16'],
    },
    {
      wave: 'triangle',
      volume: 0.26,
      bars: [
        LOBBY_HARMONY.c,
        LOBBY_HARMONY.c,
        LOBBY_HARMONY.am,
        LOBBY_HARMONY.am,
        LOBBY_HARMONY.f,
        LOBBY_HARMONY.f,
        LOBBY_HARMONY.gsus,
        LOBBY_HARMONY.g,
      ],
    },
    {
      wave: 'sine',
      volume: 0.22,
      soft: true,
      gate: 1,
      bars: [
        'e5*8 d5*4 c5*4',
        'g4*12 .*4',
        'c5*8 b4*4 a4*4',
        'e5*12 .*4',
        'a4*8 g4*4 f4*4',
        'c5*12 .*4',
        'd5*8 c5*4 d5*4',
        'b4*12 .*4',
        'g5*8 e5*4 d5*4',
        'e5*12 .*4',
        'e5*8 d5*4 c5*4',
        'a4*12 .*4',
        'c5*8 a4*4 c5*4',
        'f5*12 .*4',
        'g5*8 f5*4 d5*4',
        'd5*8 b4*4 g4*4',
      ],
    },
  ],
};

// ------------------------------------------------------------ 밤의 풀밭

/** 낮은 음과 한 옥타브 위를 오가며 달리는 베이스 */
const stride = (low: string, high: string): string =>
  `${low} . ${low} . ${high} . ${low} . ${low} . ${low} . ${high} . ${high} .`;

const MEADOW_BASS = {
  am: stride('a2', 'a3'),
  f: stride('f2', 'f3'),
  g: stride('g2', 'g3'),
  e: stride('e2', 'e3'),
  dm: stride('d3', 'd4'),
} as const;

const MEADOW_ARP = {
  am: four('a4 c5 e5 c5'),
  f: four('a4 c5 f5 c5'),
  g: four('g4 b4 d5 b4'),
  e: four('g#4 b4 e5 b4'),
} as const;

/** 쉬어 가는 대목에서는 화음을 반 빠르기로 풀어 낸다. */
const MEADOW_SLOW_ARP = {
  am: 'a4 . c5 . e5 . c5 . a4 . c5 . e5 . c5 .',
  f: 'a4 . c5 . f5 . c5 . a4 . c5 . f5 . c5 .',
  dm: 'a4 . d5 . f5 . d5 . a4 . d5 . f5 . d5 .',
  e: 'g#4 . b4 . e5 . b4 . g#4 . b4 . e5 . b4 .',
} as const;

/** 첫 가락. 두 번 되풀이되고, 두 번째 끝에서만 다음 대목으로 올라간다. */
const MEADOW_TUNE = [
  'e5*4 a5*4 g5*2 e5*2 d5*2 e5*2',
  'c5*4 d5*2 e5*6 .*4',
  'f5*4 a5*4 g5*2 f5*2 e5*2 f5*2',
  'd5*4 g5*4 b4*4 d5*4',
  'e5*4 a5*4 b5*2 c6*2 b5*2 a5*2',
  'e5*8 .*2 c5*2 d5*2 e5*2',
  'f5*6 e5*2 d5*2 c5*2 a4*4',
] as const;

const DRUM = {
  light: 'k...h...k...h...',
  full: 'k.h.s.h.k.h.s.h.',
  fill: 'k.h.s.h.k.s.s.ss',
  still: 'k.......h.......',
} as const;

/**
 * 밤의 풀밭: 가볍게 달리는 단조. 서른두 마디가 여덟 마디씩 네 대목이다.
 * 첫 가락, 화음이 깔린 첫 가락, 높이 올라가는 둘째 가락, 그리고 가락이 쉬는 대목.
 */
export const MEADOW_SONG: Song = {
  bpm: 126,
  bars: 32,
  voices: [
    // 베이스: 쉬는 대목에서는 빠지고 아래의 긴 음이 대신한다.
    {
      wave: 'triangle',
      volume: 0.5,
      gate: 0.55,
      bars: [
        ...[MEADOW_BASS.am, MEADOW_BASS.am, MEADOW_BASS.f, MEADOW_BASS.g],
        ...[MEADOW_BASS.am, MEADOW_BASS.am, MEADOW_BASS.f, MEADOW_BASS.g],
        ...[MEADOW_BASS.am, MEADOW_BASS.am, MEADOW_BASS.f, MEADOW_BASS.g],
        ...[MEADOW_BASS.am, MEADOW_BASS.am, MEADOW_BASS.f, MEADOW_BASS.g],
        ...[MEADOW_BASS.f, MEADOW_BASS.g, MEADOW_BASS.am, MEADOW_BASS.am],
        ...[MEADOW_BASS.f, MEADOW_BASS.g, MEADOW_BASS.e, MEADOW_BASS.e],
        ...times(8, REST),
      ],
    },
    {
      wave: 'triangle',
      volume: 0.42,
      soft: true,
      gate: 1,
      bars: [...times(24, REST), 'a2*16', 'a2*16', 'f3*16', 'f3*16', 'd3*16', 'd3*16', 'e3*16', 'e3*16'],
    },
    // 화음: 첫 대목에서는 쉰다.
    {
      wave: 'square',
      volume: 0.085,
      gate: 0.5,
      bars: [
        ...times(8, REST),
        ...[MEADOW_ARP.am, MEADOW_ARP.am, MEADOW_ARP.f, MEADOW_ARP.g],
        ...[MEADOW_ARP.am, MEADOW_ARP.am, MEADOW_ARP.f, MEADOW_ARP.g],
        ...[MEADOW_ARP.f, MEADOW_ARP.g, MEADOW_ARP.am, MEADOW_ARP.am],
        ...[MEADOW_ARP.f, MEADOW_ARP.g, MEADOW_ARP.e, MEADOW_ARP.e],
        ...[MEADOW_SLOW_ARP.am, MEADOW_SLOW_ARP.am, MEADOW_SLOW_ARP.f, MEADOW_SLOW_ARP.f],
        ...[MEADOW_SLOW_ARP.dm, MEADOW_SLOW_ARP.dm, MEADOW_SLOW_ARP.e, MEADOW_SLOW_ARP.e],
      ],
    },
    // 가락
    {
      wave: 'triangle',
      volume: 0.42,
      gate: 0.85,
      bars: [
        ...MEADOW_TUNE,
        'b4*4 d5*4 g5*6 .*2',
        ...MEADOW_TUNE,
        'b4*4 d5*4 g5*4 b5*4',
        'a5*6 g5*2 f5*4 c5*4',
        'b5*6 a5*2 g5*4 d5*4',
        'c6*4 b5*2 a5*2 e5*8',
        '.*4 a4*2 c5*2 e5*2 a5*2 e5*4',
        'a5*6 g5*2 f5*4 a5*4',
        'b5*6 a5*2 g5*4 b5*4',
        'e5*4 g#5*4 b5*4 e6*4',
        'd6*2 b5*2 g#5*2 e5*2 d5*2 e5*2 g#5*2 b5*2',
        ...times(6, REST),
        '.*8 e5*4 g#5*4',
        'b5*4 g#5*4 e5*4 d5*4',
      ],
    },
  ],
  drums: [
    ...times(7, DRUM.light),
    DRUM.fill,
    ...times(7, DRUM.full),
    DRUM.fill,
    ...times(7, DRUM.full),
    DRUM.fill,
    ...times(7, DRUM.still),
    DRUM.fill,
  ],
  drumVolume: 0.45,
};

// ------------------------------------------------------------ 안개 늪

/** 셋, 셋, 둘로 끊어 걷는 베이스. 뿌리음 둘 뒤에 다섯째 음이 온다. */
const wade = (root: string, fifth: string): string => `${root}*6 ${root}*6 ${fifth}*4`;

const MARSH_BASS = {
  dm: wade('d3', 'a2'),
  bb: wade('bb2', 'f3'),
  a: wade('a2', 'e3'),
  gm: wade('g2', 'd3'),
  eb: wade('eb3', 'bb2'),
} as const;

const MARSH_ARP = {
  dm: 'd4 . a3 . f4 . a3 . e4 . a3 . f4 . a3 .',
  bb: 'd4 . bb3 . f4 . bb3 . d4 . bb3 . f4 . bb3 .',
  a: 'c#4 . a3 . e4 . a3 . c#4 . a3 . e4 . a3 .',
  gm: 'd4 . bb3 . g4 . bb3 . d4 . bb3 . g4 . bb3 .',
  eb: 'eb4 . bb3 . g4 . bb3 . eb4 . bb3 . g4 . bb3 .',
} as const;

const MARSH_DRUM = {
  one: 'k.....h...h.s...',
  two: 'k.....h.k...s.h.',
  still: 'k.......h.......',
  fill: 'k.....h.k...s.ss',
} as const;

/** 앞의 여덟 마디와 쉬는 여덟 마디가 함께 쓰는 화음의 흐름 */
const MARSH_ROUND = ['dm', 'dm', 'bb', 'a', 'dm', 'dm', 'gm', 'a'] as const;
const MARSH_TURN = ['gm', 'gm', 'dm', 'dm', 'eb', 'eb', 'a', 'a'] as const;
const MARSH_FLOW = [...MARSH_ROUND, ...MARSH_TURN, ...MARSH_ROUND] as const;

/**
 * 안개 늪: 느리고 축축한 단조. 스물네 마디가 여덟 마디씩 세 대목이다.
 * 길게 끄는 가락 둘 뒤에, 가락이 쉬고 높은 데서 물방울만 떨어지는 대목이 온다.
 */
export const MARSH_SONG: Song = {
  bpm: 100,
  bars: 24,
  voices: [
    { wave: 'triangle', volume: 0.38, soft: true, bars: MARSH_FLOW.map((chord) => MARSH_BASS[chord]) },
    { wave: 'triangle', volume: 0.26, gate: 0.6, bars: MARSH_FLOW.map((chord) => MARSH_ARP[chord]) },
    // 가락
    {
      wave: 'square',
      volume: 0.075,
      soft: true,
      gate: 0.95,
      bars: [
        'a5*8 f5*4 e5*4',
        'd5*12 .*4',
        'd5*4 f5*4 bb5*8',
        'a5*6 g5*2 e5*4 c#5*4',
        'd5*4 f5*4 a5*4 d6*4',
        'c6*4 a5*4 f5*8',
        'g5*6 a5*2 bb5*4 d6*4',
        'c#6*8 a5*4 e5*4',
        'bb5*8 a5*4 g5*4',
        'd5*8 .*4 g5*2 a5*2',
        'a5*8 f5*4 d5*4',
        'a4*12 .*4',
        'g5*4 bb5*4 eb6*8',
        'd6*4 bb5*4 g5*8',
        'e5*4 a5*4 c#6*8',
        '.*8 e5*2 g5*2 a5*2 c#6*2',
        ...times(8, REST),
      ],
    },
    // 물방울: 쉬는 대목에서만 떨어진다.
    {
      wave: 'sine',
      volume: 0.24,
      gate: 0.6,
      bars: [
        ...times(16, REST),
        '.*4 a6 .*3 .*4 d6 .*3',
        '.*8 f6 .*7',
        '.*4 bb6 .*3 .*4 f6 .*3',
        '.*8 e6 .*3 c#6 .*3',
        '.*4 a6 .*3 .*4 d6 .*3',
        '.*8 f6 .*7',
        '.*4 g6 .*3 .*4 d6 .*3',
        '.*4 e6 .*3 c#6 .*3 a5 .*3',
      ],
    },
  ],
  drums: [
    ...[MARSH_DRUM.one, MARSH_DRUM.two, MARSH_DRUM.one, MARSH_DRUM.two],
    ...[MARSH_DRUM.one, MARSH_DRUM.two, MARSH_DRUM.one, MARSH_DRUM.fill],
    ...[MARSH_DRUM.one, MARSH_DRUM.two, MARSH_DRUM.one, MARSH_DRUM.two],
    ...[MARSH_DRUM.one, MARSH_DRUM.two, MARSH_DRUM.one, MARSH_DRUM.fill],
    ...times(7, MARSH_DRUM.still),
    MARSH_DRUM.fill,
  ],
  drumVolume: 0.4,
};

// ------------------------------------------------------------ 잿빛 고개

/** 발을 구르며 걷는 베이스: 길게 한 번, 짧게 두 번을 뿌리음과 다섯째 음으로 되풀이한다. */
const march = (root: string, fifth: string): string =>
  `${root}*3 ${root} ${root}*2 ${fifth}*2 ${root}*3 ${root} ${fifth}*2 ${root}*2`;

const RIDGE_BASS = {
  gm: march('g2', 'd3'),
  eb: march('eb3', 'bb2'),
  cm: march('c3', 'g2'),
  d: march('d3', 'a2'),
  bb: march('bb2', 'f3'),
  f: march('f3', 'c3'),
} as const;

const RIDGE_ARP = {
  gm: 'g3 . d4 . bb3 . d4 . g4 . d4 . bb3 . d4 .',
  eb: 'g3 . eb4 . bb3 . eb4 . g4 . eb4 . bb3 . eb4 .',
  cm: 'g3 . eb4 . c4 . eb4 . g4 . eb4 . c4 . eb4 .',
  d: 'f#3 . d4 . a3 . d4 . f#4 . d4 . a3 . d4 .',
  bb: 'f3 . d4 . bb3 . d4 . f4 . d4 . bb3 . d4 .',
  f: 'f3 . c4 . a3 . c4 . f4 . c4 . a3 . c4 .',
} as const;

const RIDGE_DRUM = {
  one: 'k..hs..hk.k.s..h',
  two: 'k..hs..hk.khs.h.',
  fill: 'k..hs..hk.k.s.ss',
} as const;

const RIDGE_FLOW = [
  ...(['gm', 'gm', 'eb', 'eb', 'cm', 'cm', 'd', 'd'] as const),
  ...(['bb', 'bb', 'f', 'f', 'eb', 'eb', 'd', 'd'] as const),
  ...(['gm', 'gm', 'eb', 'eb', 'cm', 'd', 'gm', 'gm'] as const),
] as const;

/**
 * 잿빛 고개: 발을 구르며 오르는 단조. 스물네 마디가 여덟 마디씩 세 대목이다.
 * 낮게 맴도는 첫 대목, 밝은 화음으로 올라서는 가운데 대목, 처음으로 돌아와 길게 맺는 끝 대목.
 */
export const RIDGE_SONG: Song = {
  bpm: 112,
  bars: 24,
  voices: [
    { wave: 'triangle', volume: 0.39, soft: true, bars: RIDGE_FLOW.map((chord) => RIDGE_BASS[chord]) },
    { wave: 'triangle', volume: 0.26, gate: 0.55, bars: RIDGE_FLOW.map((chord) => RIDGE_ARP[chord]) },
    // 가락
    {
      wave: 'square',
      volume: 0.075,
      soft: true,
      gate: 0.95,
      bars: [
        'd5*4 g5*4 bb5*6 a5*2',
        'g5*8 d5*4 .*4',
        'eb5*4 g5*4 bb5*6 g5*2',
        'eb5*8 .*4 g5*4',
        'c5*4 eb5*4 g5*6 f5*2',
        'eb5*8 c5*4 .*4',
        'd5*4 f#5*4 a5*8',
        'f#5*4 d5*4 a4*4 .*4',
        'bb5*6 a5*2 bb5*4 d6*4',
        'f5*8 .*4 d5*4',
        'c6*6 bb5*2 a5*4 f5*4',
        'a5*8 .*8',
        'g5*4 bb5*4 eb6*8',
        'bb5*4 g5*4 eb5*8',
        'f#5*4 a5*4 d6*8',
        '.*8 d5*2 f#5*2 a5*2 c6*2',
        'd6*4 bb5*4 g5*8',
        '.*4 d5*4 g5*4 bb5*4',
        'bb5*8 g5*4 eb5*4',
        'g5*12 .*4',
        'c5*4 eb5*4 g5*4 c6*4',
        'a5*4 f#5*4 d5*8',
        'g5*16',
        REST,
      ],
    },
  ],
  drums: [
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.two],
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.fill],
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.two],
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.fill],
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.two],
    ...[RIDGE_DRUM.one, RIDGE_DRUM.two, RIDGE_DRUM.one, RIDGE_DRUM.fill],
  ],
  drumVolume: 0.4,
};

// ------------------------------------------------------------ 보스

/** 셋씩 끊어 몰아치는 베이스 */
const gallop = (low: string, high: string): string =>
  `${low} ${low} ${high} ${low} ${low} ${high} ${low} ${low} ${high} ${low} ${low} ${high} ${low} ${high} ${low} ${high}`;

const BOSS_BASS = {
  em: gallop('e3', 'e4'),
  c: gallop('c3', 'c4'),
  d: gallop('d3', 'd4'),
  f: gallop('f3', 'f4'),
  b: gallop('b2', 'b3'),
  g: gallop('g3', 'g4'),
  a: gallop('a3', 'a4'),
} as const;

const BOSS_ARP = {
  em: four('e4 g4 b4 g4'),
  c: four('e4 g4 c5 g4'),
  d: four('f#4 a4 d5 a4'),
  f: four('f4 a4 c5 a4'),
  b: four('f#4 b4 d#5 b4'),
  g: four('g4 b4 d5 b4'),
  a: four('e4 a4 c#5 a4'),
} as const;

const BOSS_FLOW = ['em', 'em', 'c', 'd', 'em', 'em', 'f', 'b', 'em', 'g', 'a', 'b', 'c', 'd', 'em', 'b'] as const;

const BOSS_DRUM = {
  drive: 'k.hhs.hhk.hhs.hh',
  fill: 'k.hhs.hhk.s.ssss',
} as const;

/** 보스의 가락 첫 마디. 다섯째 마디에서 한 번 더 나온다. */
const BOSS_CALL = 'e5*2 e5*2 g5*2 e5*2 b5*4 a5*2 g5*2';

const BOSS_VOICES: readonly Voice[] = [
  { wave: 'triangle', volume: 0.6, gate: 0.5, bars: BOSS_FLOW.map((chord) => BOSS_BASS[chord]) },
  { wave: 'triangle', volume: 0.28, gate: 0.5, bars: BOSS_FLOW.map((chord) => BOSS_ARP[chord]) },
  {
    wave: 'square',
    volume: 0.115,
    gate: 0.8,
    bars: [
      BOSS_CALL,
      'f#5*2 g5*2 f#5*2 e5*2 b4*8',
      'e5*2 e5*2 g5*2 e5*2 c6*4 b5*2 g5*2',
      'f#5*2 a5*2 d6*4 c6*2 b5*2 a5*4',
      BOSS_CALL,
      'f#5*2 g5*2 a5*2 b5*2 e6*8',
      'f6*4 c6*4 a5*4 f5*4',
      'f#5*4 b5*4 d#6*4 f#6*4',
      'e6*6 d6*2 b5*4 g5*4',
      'd6*6 b5*2 g5*4 d5*4',
      'c#6*6 a5*2 e5*4 a5*4',
      'd#6*6 b5*2 f#5*4 b5*4',
      'e6*4 c6*4 g5*4 c6*4',
      'f#6*4 d6*4 a5*4 d6*4',
      'e6*2 b5*2 g5*2 e5*2 g5*2 b5*2 e6*2 g6*2',
      'f#6*2 d#6*2 b5*2 f#5*2 b5*8',
    ],
  },
];

/** 중간 보스: 쫓기듯 빠른 단조. 열여섯 마디. */
export const BOSS_SONG: Song = {
  bpm: 150,
  bars: 16,
  voices: BOSS_VOICES,
  drums: [...times(7, BOSS_DRUM.drive), BOSS_DRUM.fill],
  drumVolume: 0.5,
};

/** 마지막 보스: 같은 곡을 더 빠르고 한 음 높게 연주한다. */
export const FINAL_SONG: Song = { ...BOSS_SONG, bpm: 164, transpose: 2 };

export const STAGE_SONGS: Readonly<Record<StageId, Song>> = {
  meadow: MEADOW_SONG,
  marsh: MARSH_SONG,
  ridge: RIDGE_SONG,
};

export const SONGS = {
  lobby: LOBBY_SONG,
  meadow: MEADOW_SONG,
  marsh: MARSH_SONG,
  ridge: RIDGE_SONG,
  boss: BOSS_SONG,
  final: FINAL_SONG,
} as const;
