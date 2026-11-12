/**
 * 등불지기 전용 픽셀 텍스처. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 문자열 한 글자가 한 픽셀이고, 0~f는 config.ts의 PALETTE 번호, '.'은 투명이다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import type { HeroId, StageId } from './data';
import { ICON_IDS, ICONS, iconKey, withOutline } from './icons';

type Rows = readonly string[];

export const LK = {
  keeper: ['lk-keeper-1', 'lk-keeper-2'],
  stargazer: ['lk-stargazer-1', 'lk-stargazer-2'],
  stormer: ['lk-stormer-1', 'lk-stormer-2'],
  ringer: ['lk-ringer-1', 'lk-ringer-2'],
  shade: ['lk-shade-1', 'lk-shade-2'],
  bat: ['lk-bat-1', 'lk-bat-2'],
  wisp: ['lk-wisp-1', 'lk-wisp-2'],
  brute: ['lk-brute-1', 'lk-brute-2'],
  glare: ['lk-glare-1', 'lk-glare-2'],
  puff: ['lk-puff-1', 'lk-puff-2'],
  drip: ['lk-drip-1', 'lk-drip-2'],
  moth: ['lk-moth-1', 'lk-moth-2'],
  toad: ['lk-toad-1', 'lk-toad-2'],
  stump: ['lk-stump-1', 'lk-stump-2'],
  squirt: ['lk-squirt-1', 'lk-squirt-2'],
  spore: ['lk-spore-1', 'lk-spore-2'],
  cinder: ['lk-cinder-1', 'lk-cinder-2'],
  soot: ['lk-soot-1', 'lk-soot-2'],
  clinker: ['lk-clinker-1', 'lk-clinker-2'],
  slag: ['lk-slag-1', 'lk-slag-2'],
  smoker: ['lk-smoker-1', 'lk-smoker-2'],
  blister: ['lk-blister-1', 'lk-blister-2'],
  flake: ['lk-flake-1', 'lk-flake-2'],
  sleet: ['lk-sleet-1', 'lk-sleet-2'],
  frost: ['lk-frost-1', 'lk-frost-2'],
  floe: ['lk-floe-1', 'lk-floe-2'],
  hail: ['lk-hail-1', 'lk-hail-2'],
  bloat: ['lk-bloat-1', 'lk-bloat-2'],
  prowler: ['lk-prowler-1', 'lk-prowler-2'],
  lurker: ['lk-lurker-1', 'lk-lurker-2'],
  stoker: ['lk-stoker-1', 'lk-stoker-2'],
  fang: ['lk-fang-1', 'lk-fang-2'],
  giant: ['lk-giant-1', 'lk-giant-2'],
  ram: ['lk-ram-1', 'lk-ram-2'],
  owl: ['lk-owl-1', 'lk-owl-2'],
  lord: ['lk-lord-1', 'lk-lord-2'],
  matron: ['lk-matron-1', 'lk-matron-2'],
  warden: ['lk-warden-1', 'lk-warden-2'],
  blizzard: ['lk-blizzard-1', 'lk-blizzard-2'],
  /** 보스가 쏘는 빛덩이 */
  orb: 'lk-orb',
  gemSmall: 'lk-gem-s',
  gemMid: 'lk-gem-m',
  gemBig: 'lk-gem-b',
  heal: 'lk-heal',
  pull: 'lk-pull',
  blast: 'lk-blast',
  /** 보물 상자 */
  chest: 'lk-chest',
  /** 등불 기둥: 켜기 전과 켜진 뒤 */
  post: 'lk-post',
  postLit: 'lk-post-lit',
  heart: 'lk-heart',
  ember: 'lk-ember',
  emberEvo: 'lk-ember-evo',
  firefly: 'lk-firefly',
  fireflyEvo: 'lk-firefly-evo',
  star: 'lk-star',
  starEvo: 'lk-star-evo',
  lance: 'lk-lance',
  lanceEvo: 'lk-lance-evo',
  moon: 'lk-moon',
  moonEvo: 'lk-moon-evo',
  floor: 'lk-floor',
  floorMarsh: 'lk-floor-marsh',
  floorRidge: 'lk-floor-ridge',
  floorTundra: 'lk-floor-tundra',
  spark: 'lk-spark',
} as const;

/** 스테이지마다 깔리는 바닥 */
export const FLOOR_OF: Readonly<Record<StageId, string>> = {
  meadow: LK.floor,
  marsh: LK.floorMarsh,
  ridge: LK.floorRidge,
  tundra: LK.floorTundra,
};

/** 캐릭터의 걷는 그림 두 장 */
export const HERO_FRAMES: Readonly<Record<HeroId, readonly [string, string]>> = {
  keeper: LK.keeper,
  stargazer: LK.stargazer,
  stormer: LK.stormer,
  ringer: LK.ringer,
};

/**
 * 도형으로 그리는 효과의 색. 그림체를 바꿀 때는 이 파일(스프라이트 문자열, 색 번호, 이 표)만 고치면 된다.
 */
export const LOOK = {
  aura: COLOR.yellow,
  auraEdge: COLOR.orange,
  auraEvo: COLOR.white,
  auraEvoEdge: COLOR.yellow,
  strike: COLOR.yellow,
  fire: COLOR.orange,
  fireCore: COLOR.yellow,
  fireEvo: COLOR.red,
  /** 종소리의 고리와, 부싯돌이 터진 자리 */
  bell: COLOR.yellow,
  bellEvo: COLOR.cyan,
  flint: COLOR.orange,
  bolt: COLOR.white,
  boltGlow: COLOR.cyan,
  boltEvoGlow: COLOR.yellow,
  /** 안개 늪의 웅덩이 */
  puddle: COLOR.navy,
  puddleRim: COLOR.teal,
  puddleShine: COLOR.sky,
  /** 잿빛 고개의 불구멍: 잠잠할 때의 구덩이와 테두리, 달아오를 때와 솟을 때의 불빛 */
  vent: COLOR.ink,
  ventRim: COLOR.plum,
  ventWarm: COLOR.orange,
  ventFire: COLOR.yellow,
  ventCore: COLOR.white,
  /** 바람 설원의 돌풍: 바람결과, 발이 얼었을 때 캐릭터에 도는 빛 */
  wind: COLOR.white,
  chill: COLOR.cyan,
  /** 보스의 공격 예고: 돌진할 길, 쏘려고 모으는 빛 */
  threat: COLOR.red,
  threatCore: COLOR.white,
  /** 화면 밖의 보스를 가리키는 화살표의 테두리. 어두운 바닥에서도 보이도록 밝게 두른다. */
  pointerEdge: COLOR.white,
  /** 등갓의 빛막 */
  guard: COLOR.cyan,
  /** 등불 기둥의 빛 */
  postLight: COLOR.yellow,
  postEdge: COLOR.orange,
  /** 등불 기둥을 가리키는 화살표의 테두리 */
  postPointerEdge: COLOR.ink,
} as const;

/**
 * 이 게임의 패널은 밤 분위기에 맞춰 어둡게 그린다. 앱의 기본 패널(밝은 카드, 옅은 그림자) 대신
 * drawPanel에 이 색을 넘긴다.
 */
export const DARK_PANEL = { fill: COLOR.charcoal, shadow: COLOR.ink } as const;

/** 맞았을 때 잠깐 하얗게 보이는 텍스처의 이름 */
export const flashOf = (key: string): string => `${key}-flash`;

/** 등불을 든 수호자. 차가운 색의 적 사이에서 눈에 띄도록 따뜻한 색으로 칠한다. */
const KEEPER_TOP: Rows = [
  '....000000......',
  '...04444440.....',
  '..0444444440....',
  '..044cccc440....',
  '..04c0cc0c40....',
  '..04cccccc40....',
  '...04cccc40.000.',
  '..02333332004440',
  '.022333322004c40',
  '.022333322004440',
  '.0222332220.000.',
  '.0222222220.....',
  '..02222220......',
  '..00222200......',
];
const LEGS_1: Rows = ['...0e0.0e0......', '...00...00......'];
const LEGS_2: Rows = ['....0e00e0......', '....00.00.......'];
const KEEPER_1: Rows = [...KEEPER_TOP, ...LEGS_1];
const KEEPER_2: Rows = [...KEEPER_TOP, ...LEGS_2];

/** 글자 하나를 다른 색 번호로 바꿔 같은 모양을 다른 색으로 칠한다. */
const recolor = (rows: Rows, map: Readonly<Record<string, string>>): Rows =>
  rows.map((row) => [...row].map((cell) => map[cell] ?? cell).join(''));

/** 별지기: 뾰족한 모자에 푸른 옷, 손에는 별 지팡이 */
const STARGAZER_TOP: Rows = [
  '......00........',
  '.....0990.......',
  '....099990......',
  '...09949990.....',
  '..0999999990....',
  '.0aaaaaaaaaa0...',
  '..0c0cc0c0...0..',
  '..0cccccc0..040.',
  '..09999990.04c40',
  '.0999999990.040.',
  '.0999aa9990..0..',
  '.0999999990..0..',
  '..09999990...0..',
  '..00999900......',
];

/** 번개잡이: 초록 두건에 하늘색 목도리, 손에는 번개를 담은 등 */
const STORMER_TOP: Rows = [
  ...recolor(KEEPER_TOP.slice(0, 6), { '4': '6' }),
  '...0bbbbbb0.000.',
  ...recolor(KEEPER_TOP.slice(7), { '2': '7', '3': '6', '4': 'b' }),
];

/** 종지기: 붉은 두건에 흰 옷, 손에는 등불 대신 종 */
const RINGER_BELL: Rows = ['.....', '.....', '.....', '.....', '.....', '.....', '..0..', '.040.', '04440', '04c40', '00300', '..0..', '.....', '.....'];
const RINGER_TOP: Rows = recolor(
  KEEPER_TOP.map((row) => row.slice(0, 11)),
  { '4': '2', '2': 'd', '3': 'c' },
).map((row, index) => row + RINGER_BELL[index]);

const BAT_1: Rows = [
  '0............0',
  '020........020',
  '0220.0000.0220',
  '02220222202220',
  '.0222c22c2220.',
  '..0222222220..',
  '...00200200...',
  '.....0..0.....',
];
const BAT_2: Rows = [
  '..............',
  '.....0000.....',
  '...00222200...',
  '.002222222200.',
  '02222c22c22220',
  '0220.2222.0220',
  '020...00...020',
  '0............0',
];

const WISP_1: Rows = [
  '....00....',
  '...0aa0...',
  '...0ab0...',
  '..0abba0..',
  '..0abba0..',
  '.0abbbba0.',
  '.0abccba0.',
  '0ab0cc0ba0',
  '0abccccba0',
  '0aabccbaa0',
  '.0aabbaa0.',
  '..000000..',
];
/** 불꽃 끝이 옆으로 흔들린다. */
const WISP_2: Rows = [...WISP_1.slice(0, 3).map((row) => `.${row.slice(0, -1)}`), ...WISP_1.slice(3)];

/** 빛화살. 오른쪽을 보게 그리고, 날아가는 쪽으로 돌려서 쓴다. */
const LANCE: Rows = [
  '.........c..',
  '.4444444ccc.',
  'cccccccccccc',
  '.4444444ccc.',
  '.........c..',
];
const LANCE_EVO: Rows = [
  '...........cc...',
  '..33333333cccc..',
  '.3444444444cccc.',
  '44cccccccccccccc',
  '.3444444444cccc.',
  '..33333333cccc..',
  '...........cc...',
];

/** 초승달. 빙글빙글 돌면서 날아간다. */
const MOON: Rows = [
  '.....cdd.....',
  '...ccd.......',
  '..ccd........',
  '.ccd.........',
  '.ccd.........',
  'cccd.........',
  'cccd.........',
  'cccd.........',
  '.cccd........',
  '.cccdd.......',
  '..cccdd......',
  '...cccccdd...',
  '.....ccc.....',
];
/** 보름달. 가장자리가 노랗게 빛난다. */
const MOON_EVO: Rows = [
  '.......444.......',
  '....444ccc444....',
  '...44ccccccc44...',
  '..4ccccccccccc4..',
  '.44ccccccdcccc44.',
  '.4cccddcccccccc4.',
  '.4cccddcccccdcc4.',
  '4ccccccccccccccc4',
  '4ccccccccccccccc4',
  '4ccccccccccccccc4',
  '.4ccdcccccddccc4.',
  '.4ccccccccddccc4.',
  '.44ccccdcccccc44.',
  '..4ccccccccccc4..',
  '...44ccccccc44...',
  '....444ccc444....',
  '.......444.......',
];

/** 회복 떡 */
const HEAL: Rows = [
  '..0000..',
  '.0cccc0.',
  '0cc22cc0',
  '0c2222c0',
  '0cc22cc0',
  '0dccccd0',
  '.0dddd0.',
  '..0000..',
];

/** 자석: 주우면 빛 조각이 모두 끌려온다. 드물게 나오므로 빛 조각보다 크게 그린다. */
const PULL: Rows = [
  '0000..0000',
  '0cc0..0cc0',
  '0cc0..0cc0',
  '0220..0220',
  '0220..0220',
  '0220000220',
  '0222222220',
  '0222222220',
  '.02222220.',
  '..000000..',
];

/** 불꽃 단지: 주우면 화면의 그림자가 타 버린다. */
const BLAST: Rows = [
  '....00....',
  '...04c0...',
  '...0440...',
  '..000000..',
  '.0dddddd0.',
  '0334333330',
  '0343333320',
  '0333333220',
  '.03332220.',
  '..000000..',
];

/** 보물 상자: 정예 그림자가 떨어뜨린다. 주우면 가진 것 하나가 한 단계 오른다. */
const CHEST: Rows = [
  '..00000000..',
  '.0433333340.',
  '043333333340',
  '044444444440',
  '033330c03330',
  '022220402220',
  '022222222220',
  '044444444440',
  '.0000000000.',
];

/** 등불 기둥의 기둥과 받침. 위에 등을 얹어 한 장을 만든다. */
const POST_POLE: Rows = [
  '...0e0...',
  '...0d0...',
  '...0e0...',
  '...0d0...',
  '...0e0...',
  '...0d0...',
  '...0e0...',
  '..00e00..',
  '.0eeeee0.',
  '.0000000.',
];

/** 켜기 전의 등: 불씨만 남아 있다. */
const POST: Rows = ['...000...', '..0ddd0..', '.0df3fd0.', '.0d343d0.', '.0df3fd0.', '..0ddd0..', ...POST_POLE];

/** 켜진 등 */
const POST_LIT: Rows = ['...000...', '..03330..', '.034c430.', '.04ccc40.', '.034c430.', '..03330..', ...POST_POLE];

/** HUD의 체력 표시 옆에 놓는 하트. 테두리는 withOutline이 두른다. */
const HEART: Rows = [
  '.22...22.',
  '2c22.2222',
  '2c2222222',
  '222222222',
  '.2222222.',
  '..22222..',
  '...222...',
  '....2....',
];

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  return [canvas, context];
}

/** flash면 그림이 있는 픽셀을 모두 흰색으로 칠한다. */
function drawRows(rows: Rows, flash = false): HTMLCanvasElement {
  const [canvas, context] = canvasOf(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (Number.isNaN(index)) continue;
      context.fillStyle = flash ? PALETTE[12] : PALETTE[index];
      context.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

interface BlobLook {
  size: number;
  body: number;
  shade: number;
  eye: number;
  /** 왕관을 씌운다 */
  crown?: boolean;
  /** 아래쪽 물결 */
  frill?: boolean;
  /** 머리 양쪽에 솟은 것. horn은 바깥으로 휜 흰 뿔, tuft는 몸과 같은 색의 뾰족한 깃 */
  ears?: 'horn' | 'tuft';
  /** 뿔의 색. 없으면 희다. 정예 그림자는 금빛 뿔로 알아본다. */
  horn?: number;
}

/**
 * 동그란 그림자 괴물을 그린다. 크기만 바꿔 작은 적부터 보스까지 같은 모양으로 만든다.
 * frame 2는 위아래로 살짝 눌려 꿈틀거리는 것처럼 보인다.
 */
function blobRows(look: BlobLook, frame: 1 | 2): Rows {
  const { size } = look;
  const crownRows = look.crown ? Math.round(size / 4) : look.ears ? Math.round(size / 5) : 0;
  const height = size + crownRows;
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(size).fill('.'));
  const cx = size / 2;
  const squash = frame === 2 ? 0.92 : 1;
  const ry = (size / 2) * squash;
  const cy = crownRows + size - ry;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - cx) / (size / 2);
      const py = crownRows + y + 0.5;
      const dy = (py - cy) / ry;
      // 아래쪽은 조금 넓고 평평한 물방울 모양
      const d = Math.hypot(dx * (dy > 0 ? 0.92 : 1), dy);
      if (d > 1) continue;
      let color = d > 0.84 ? 0 : look.body;
      if (color !== 0 && dx < -0.2 && dy < -0.3 && d > 0.55) color = look.shade;
      grid[crownRows + y][x] = color.toString(16);
    }
  }
  // 물결치는 아랫단: 한 칸씩 건너 구멍을 낸다.
  if (look.frill) {
    const bottom = height - 1;
    for (let x = 0; x < size; x += 1) {
      if ((x + frame) % 3 === 0 && grid[bottom][x] !== '.') grid[bottom][x] = '.';
    }
  }
  // 눈: 가로 가운데에서 대칭으로 두 칸씩
  const eyeY = Math.round(cy - ry * 0.15);
  const eyeGap = Math.max(1, Math.round(size / 7));
  const eyeSize = size >= 20 ? 2 : 1;
  for (const side of [-1, 1]) {
    const ex = Math.round(cx + side * eyeGap - (side < 0 ? eyeSize : 0));
    for (let i = 0; i < eyeSize; i += 1) {
      for (let j = 0; j < eyeSize + (size >= 12 ? 1 : 0); j += 1) {
        const gx = ex + i;
        const gy = eyeY + j;
        if (grid[gy]?.[gx] !== undefined && grid[gy][gx] !== '.') grid[gy][gx] = look.eye.toString(16);
      }
    }
  }
  // 뿔이나 깃: 머리 양쪽에서 위로 솟는 세모. 뿔은 끝이 바깥으로 휜다.
  if (look.ears) {
    const tall = crownRows + Math.round(size / 6);
    const wide = Math.max(3, Math.round(size / 6));
    const lean = look.ears === 'horn' ? Math.round(size / 9) : 0;
    const fill = (look.ears === 'horn' ? (look.horn ?? 12) : look.body).toString(16);
    for (const side of [-1, 1]) {
      const base = Math.round(cx + side * size * 0.27);
      for (let k = 0; k < tall; k += 1) {
        const t = k / (tall - 1);
        const span = Math.max(1, Math.round(1 + (wide - 1) * t));
        const middle = base + side * Math.round(lean * (1 - t) * (1 - t));
        const from = middle - Math.floor(span / 2);
        for (let i = -1; i <= span; i += 1) {
          const gx = from + i;
          if (grid[k]?.[gx] === undefined) continue;
          const edge = i === -1 || i === span;
          // 몸 안쪽에는 테두리를 긋지 않아 머리와 자연스럽게 이어진다.
          if (edge && grid[k][gx] !== '.') continue;
          grid[k][gx] = edge ? '0' : fill;
        }
      }
      // 뾰족한 끝 위에 테두리 한 점
      const tip = base + side * lean;
      if (grid[0]?.[tip] !== undefined) grid[0][tip] = '0';
    }
  }
  // 왕관: 뾰족한 세 봉우리
  if (look.crown) {
    const left = Math.round(size * 0.25);
    const right = Math.round(size * 0.75);
    for (let x = left; x < right; x += 1) {
      const t = (x - left) / (right - left);
      const peak = Math.abs(Math.sin(t * Math.PI * 3));
      const top = Math.round((1 - peak) * (crownRows - 1));
      for (let y = top; y < crownRows + 2; y += 1) {
        grid[y][x] = y === top || x === left || x === right - 1 ? '0' : y === crownRows ? '3' : '4';
      }
    }
  }
  return grid.map((row) => row.join(''));
}

const BLOBS = {
  shade: { size: 12, body: 1, shade: 2, eye: 12, frill: true },
  brute: { size: 16, body: 14, shade: 13, eye: 3 },
  // 쏘는 적은 빛덩이를 쏘는 보스(안개 올빼미)처럼 뾰족한 깃이 있고, 터지는 적은 불씨 색으로 둥글다.
  glare: { size: 13, body: 9, shade: 10, eye: 4, ears: 'tuft' },
  puff: { size: 13, body: 2, shade: 3, eye: 12 },
  drip: { size: 12, body: 7, shade: 6, eye: 12, frill: true },
  toad: { size: 13, body: 6, shade: 5, eye: 4 },
  stump: { size: 18, body: 14, shade: 6, eye: 5 },
  squirt: { size: 13, body: 1, shade: 2, eye: 4, ears: 'tuft' },
  spore: { size: 14, body: 3, shade: 4, eye: 0 },
  // 잿빛 고개: 재와 숯의 잿빛에 불씨 색 눈. 쏘는 적과 터지는 적은 다른 스테이지와 같은 약속을 따른다.
  cinder: { size: 12, body: 13, shade: 14, eye: 2, frill: true },
  clinker: { size: 14, body: 14, shade: 15, eye: 3 },
  slag: { size: 18, body: 2, shade: 3, eye: 4 },
  smoker: { size: 13, body: 14, shade: 13, eye: 12, ears: 'tuft' },
  blister: { size: 13, body: 3, shade: 4, eye: 0 },
  // 바람 설원: 눈과 얼음의 흰빛과 하늘빛. 쏘는 적과 터지는 적은 다른 스테이지와 같은 약속을 따른다.
  flake: { size: 12, body: 12, shade: 13, eye: 9, frill: true },
  frost: { size: 13, body: 10, shade: 11, eye: 12, frill: true },
  floe: { size: 18, body: 9, shade: 10, eye: 12 },
  hail: { size: 13, body: 14, shade: 13, eye: 11, ears: 'tuft' },
  bloat: { size: 13, body: 3, shade: 4, eye: 0 },
  // 정예 그림자: 그 스테이지의 흔한 그림자를 크게 키운 모습에 금빛 뿔이 솟았다.
  prowler: { size: 22, body: 1, shade: 2, eye: 4, ears: 'horn', horn: 4, frill: true },
  lurker: { size: 22, body: 6, shade: 5, eye: 4, ears: 'horn', horn: 4 },
  stoker: { size: 23, body: 14, shade: 13, eye: 3, ears: 'horn', horn: 4, frill: true },
  fang: { size: 22, body: 10, shade: 11, eye: 12, ears: 'horn', horn: 4, frill: true },
  giant: { size: 30, body: 7, shade: 6, eye: 4, frill: true },
  ram: { size: 28, body: 3, shade: 4, eye: 0, ears: 'horn' },
  owl: { size: 28, body: 9, shade: 10, eye: 4, ears: 'tuft', frill: true },
  lord: { size: 34, body: 2, shade: 3, eye: 12, crown: true, frill: true },
  matron: { size: 34, body: 6, shade: 5, eye: 4, crown: true, frill: true },
  warden: { size: 34, body: 14, shade: 3, eye: 4, crown: true, frill: true },
  blizzard: { size: 34, body: 12, shade: 13, eye: 9, crown: true, frill: true },
} as const satisfies Record<string, BlobLook>;

function drawGem(size: number, rim: number, body: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d > c + 0.01) continue;
      context.fillStyle = PALETTE[d > c - 1 ? rim : body];
      context.fillRect(x, y, 1, 1);
    }
  }
  context.fillStyle = PALETTE[12];
  context.fillRect(Math.floor(c) - (size > 5 ? 1 : 0), Math.floor(c) - 1, 1, 1);
  return canvas;
}

function drawDot(size: number, rings: ReadonlyArray<readonly [number, number]>): HTMLCanvasElement {
  const [canvas, context] = canvasOf(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let color = -1;
      for (const [r, index] of rings) if (d <= r) color = index;
      if (color < 0) continue;
      context.fillStyle = PALETTE[color];
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/** 안개 늪. 풀밭보다 푸르고 축축한 바탕에 갈대와 물기 어린 점을 박는다. */
function drawMarshFloor(): HTMLCanvasElement {
  const size = 48;
  const [canvas, context] = canvasOf(size, size);
  context.fillStyle = '#243a4a';
  context.fillRect(0, 0, size, size);
  // 갈대: 길고 가는 줄기 두 가닥씩. 적과 빛 조각이 묻히지 않게 바탕보다 조금만 밝다.
  context.fillStyle = '#2f6b5c';
  for (const [x, y] of [
    [8, 10],
    [34, 6],
    [20, 30],
    [42, 36],
  ]) {
    context.fillRect(x, y, 1, 4);
    context.fillRect(x + 2, y + 1, 1, 3);
  }
  context.fillStyle = '#2c5563';
  for (const [x, y, w] of [
    [2, 24, 4],
    [28, 18, 3],
    [14, 44, 4],
    [38, 46, 3],
    [12, 3, 3],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  context.fillStyle = PALETTE[8];
  for (const [x, y] of [
    [30, 40],
    [18, 16],
    [44, 22],
  ]) {
    context.fillRect(x, y, 2, 1);
  }
  return canvas;
}

/** 잿빛 고개. 식은 재의 어두운 바탕에 갈라진 금과 꺼져 가는 불씨를 박는다. */
function drawRidgeFloor(): HTMLCanvasElement {
  const size = 48;
  const [canvas, context] = canvasOf(size, size);
  context.fillStyle = '#34292f';
  context.fillRect(0, 0, size, size);
  // 갈라진 금: 꺾인 가는 줄
  context.fillStyle = '#261d23';
  for (const [x, y, w] of [
    [4, 9, 5],
    [8, 10, 3],
    [30, 26, 6],
    [35, 27, 3],
    [16, 40, 5],
    [40, 6, 4],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  // 자갈
  context.fillStyle = '#4a3c44';
  for (const [x, y, w] of [
    [22, 14, 2],
    [10, 28, 3],
    [42, 38, 2],
    [28, 44, 2],
    [2, 20, 2],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  // 꺼져 가는 불씨: 적과 빛 조각이 묻히지 않게 어둡게 둔다.
  context.fillStyle = '#7a3b2e';
  for (const [x, y] of [
    [14, 6],
    [36, 18],
    [6, 36],
    [26, 32],
  ]) {
    context.fillRect(x, y, 1, 1);
  }
  return canvas;
}

/** 바람 설원. 해 진 뒤의 눈밭처럼 푸르스름하게 어두운 바탕에 바람이 쓸고 간 결과 눈송이를 박는다. */
function drawTundraFloor(): HTMLCanvasElement {
  const size = 48;
  const [canvas, context] = canvasOf(size, size);
  context.fillStyle = '#374660';
  context.fillRect(0, 0, size, size);
  // 바람이 쓸고 간 결: 비스듬히 이어지는 어두운 줄
  context.fillStyle = '#2c3950';
  for (const [x, y, w] of [
    [3, 8, 6],
    [9, 9, 4],
    [26, 20, 7],
    [33, 21, 3],
    [12, 34, 6],
    [38, 40, 5],
    [43, 41, 3],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  // 쌓인 눈의 밝은 등성이. 적과 빛 조각이 묻히지 않게 바탕보다 조금만 밝다.
  context.fillStyle = '#4a5c7a';
  for (const [x, y, w] of [
    [18, 5, 5],
    [36, 12, 4],
    [4, 24, 5],
    [22, 44, 5],
    [40, 30, 4],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  // 눈송이
  context.fillStyle = '#9fb2cc';
  for (const [x, y] of [
    [10, 16],
    [30, 6],
    [44, 24],
    [20, 28],
    [6, 42],
    [34, 36],
  ]) {
    context.fillRect(x, y, 1, 1);
  }
  return canvas;
}

/** 밤의 풀밭. 어두운 바탕에 드문드문 풀포기와 돌을 박는다. */
function drawFloor(): HTMLCanvasElement {
  const size = 48;
  const [canvas, context] = canvasOf(size, size);
  context.fillStyle = PALETTE[15];
  context.fillRect(0, 0, size, size);
  context.fillStyle = PALETTE[7];
  for (const [x, y] of [
    [6, 8],
    [30, 4],
    [40, 30],
    [14, 36],
    [24, 20],
  ]) {
    context.fillRect(x, y, 1, 2);
    context.fillRect(x + 2, y - 1, 1, 3);
    context.fillRect(x + 4, y, 1, 2);
  }
  context.fillStyle = PALETTE[0];
  for (const [x, y, w] of [
    [2, 22, 3],
    [36, 14, 2],
    [20, 44, 3],
    [44, 42, 2],
    [10, 2, 2],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  context.fillStyle = PALETTE[14];
  for (const [x, y] of [
    [33, 40],
    [17, 12],
  ]) {
    context.fillRect(x, y, 2, 1);
  }
  return canvas;
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** 등불 빛이 닿는 가운데는 비우고 가장자리로 갈수록 어두워지는 덮개. 계단 사이는 점무늬로 잇는다. */
function drawDarkness(width: number, height: number, clear: number, reach: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(width, height);
  const image = context.createImageData(width, height);
  const steps = 4;
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const v = Math.min(1, Math.max(0, (d - clear) / reach)) * steps;
      const band = Math.min(steps, Math.floor(v + (BAYER[y & 3][x & 3] + 0.5) / 16));
      const offset = (y * width + x) * 4;
      image.data[offset] = 16;
      image.data[offset + 1] = 14;
      image.data[offset + 2] = 34;
      image.data[offset + 3] = Math.round(band * 0.15 * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** 게임 전체의 픽셀 그림 설정과 상관없이, 이 게임의 텍스처는 늘 또렷한 픽셀로 보이게 등록한다. */
function addPixelTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  scene.textures.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** 화면 크기에 맞는 어둠 덮개 텍스처를 만들고 그 이름을 돌려준다. */
export function darknessTexture(scene: Phaser.Scene, width: number, height: number): string {
  const key = `lk-dark-${width}x${height}`;
  if (!scene.textures.exists(key)) {
    addPixelTexture(scene, key, drawDarkness(width, height, 64, 150));
  }
  return key;
}

/** 화면 가장자리만 붉게 물들이는 덮개. 가운데는 비어 있어 싸움을 가리지 않는다. */
function drawDanger(width: number, height: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(width, height);
  const image = context.createImageData(width, height);
  const steps = 4;
  // 화면이 세로로 길어서 위아래를 조금 더 깊게 물들인다.
  const reachX = 24;
  const reachY = 36;
  const red = (COLOR.red >> 16) & 0xff;
  const green = (COLOR.red >> 8) & 0xff;
  const blue = COLOR.red & 0xff;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nearX = 1 - Math.min(x, width - 1 - x) / reachX;
      const nearY = 1 - Math.min(y, height - 1 - y) / reachY;
      const v = Math.min(1, Math.max(0, nearX, nearY)) * steps;
      const band = Math.min(steps, Math.floor(v + (BAYER[y & 3][x & 3] + 0.5) / 16));
      const offset = (y * width + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = Math.round(band * 0.14 * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** 새벽빛: 화면 위쪽에서 따뜻한 빛이 번져 내려온다. 위는 노랗고 아래로 갈수록 붉어지며 옅어진다. */
function drawDawn(width: number, height: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(width, height);
  const image = context.createImageData(width, height);
  const steps = 5;
  const reach = height * 0.8;
  const channels = (color: number): [number, number, number] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  const top = channels(COLOR.yellow);
  const low = channels(COLOR.orange);
  for (let y = 0; y < height; y += 1) {
    const depth = Math.min(1, y / reach);
    const mix = Math.min(1, depth * 1.6);
    for (let x = 0; x < width; x += 1) {
      const band = Math.min(steps, Math.floor((1 - depth) * steps + (BAYER[y & 3][x & 3] + 0.5) / 16));
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) image.data[offset + c] = Math.round(top[c] + (low[c] - top[c]) * mix);
      image.data[offset + 3] = Math.round(band * 0.11 * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** 새벽빛 텍스처를 만들고(이미 있으면 그대로) 이름을 돌려준다. */
export function dawnTexture(scene: Phaser.Scene, width: number, height: number): string {
  const key = `lk-dawn-${width}x${height}`;
  if (!scene.textures.exists(key)) addPixelTexture(scene, key, drawDawn(width, height));
  return key;
}

/** 화면 가장자리의 붉은 덮개 텍스처를 만들고(이미 있으면 그대로) 이름을 돌려준다. */
export function dangerTexture(scene: Phaser.Scene, width: number, height: number): string {
  const key = `lk-danger-${width}x${height}`;
  if (!scene.textures.exists(key)) addPixelTexture(scene, key, drawDanger(width, height));
  return key;
}

/** 이 게임에서 쓰는 텍스처를 모두 만든다. 이미 있으면 건너뛴다. */
export function registerLanternTextures(scene: Phaser.Scene): void {
  const add = (key: string, canvas: HTMLCanvasElement): void => {
    if (!scene.textures.exists(key)) addPixelTexture(scene, key, canvas);
  };
  const addWithFlash = (key: string, rows: Rows): void => {
    add(key, drawRows(rows));
    add(flashOf(key), drawRows(rows, true));
  };

  addWithFlash(LK.keeper[0], KEEPER_1);
  addWithFlash(LK.keeper[1], KEEPER_2);
  addWithFlash(LK.stargazer[0], [...STARGAZER_TOP, ...LEGS_1]);
  addWithFlash(LK.stargazer[1], [...STARGAZER_TOP, ...LEGS_2]);
  addWithFlash(LK.stormer[0], [...STORMER_TOP, ...LEGS_1]);
  addWithFlash(LK.stormer[1], [...STORMER_TOP, ...LEGS_2]);
  addWithFlash(LK.ringer[0], [...RINGER_TOP, ...LEGS_1]);
  addWithFlash(LK.ringer[1], [...RINGER_TOP, ...LEGS_2]);
  addWithFlash(LK.bat[0], BAT_1);
  addWithFlash(LK.bat[1], BAT_2);
  // 안개나방은 박쥐와 같은 모양에 날개만 잿빛이다.
  addWithFlash(LK.moth[0], recolor(BAT_1, { '2': 'd' }));
  addWithFlash(LK.moth[1], recolor(BAT_2, { '2': 'd' }));
  // 검댕 날개도 같은 모양에 날개가 불씨 색이다.
  addWithFlash(LK.soot[0], recolor(BAT_1, { '2': '3' }));
  addWithFlash(LK.soot[1], recolor(BAT_2, { '2': '3' }));
  // 서리나비도 같은 모양에 날개가 얼음빛이다.
  addWithFlash(LK.sleet[0], recolor(BAT_1, { '2': 'b' }));
  addWithFlash(LK.sleet[1], recolor(BAT_2, { '2': 'b' }));
  addWithFlash(LK.wisp[0], WISP_1);
  addWithFlash(LK.wisp[1], WISP_2);
  for (const kind of Object.keys(BLOBS) as Array<keyof typeof BLOBS>) {
    addWithFlash(LK[kind][0], blobRows(BLOBS[kind], 1));
    addWithFlash(LK[kind][1], blobRows(BLOBS[kind], 2));
  }
  add(LK.gemSmall, drawGem(7, 10, 11));
  add(LK.gemMid, drawGem(9, 6, 5));
  add(LK.gemBig, drawGem(11, 3, 4));
  add(
    LK.ember,
    drawDot(6, [
      [3, 2],
      [2.2, 3],
      [1.3, 4],
    ]),
  );
  add(
    LK.firefly,
    drawDot(7, [
      [3.5, 6],
      [2.5, 5],
      [1.5, 4],
    ]),
  );
  add(
    LK.star,
    drawDot(8, [
      [4, 3],
      [3, 4],
      [1.6, 12],
    ]),
  );
  add(
    LK.emberEvo,
    drawDot(8, [
      [4, 2],
      [3.2, 3],
      [2.3, 4],
      [1.2, 12],
    ]),
  );
  add(
    LK.fireflyEvo,
    drawDot(9, [
      [4.5, 10],
      [3.5, 11],
      [2, 12],
    ]),
  );
  add(
    LK.starEvo,
    drawDot(10, [
      [5, 3],
      [4, 4],
      [2.4, 12],
    ]),
  );
  add(
    LK.orb,
    drawDot(9, [
      [4.5, 0],
      [3.6, 2],
      // 가운데는 네모나게 밝힌다. 십자 모양이면 회복 떡처럼 읽힌다.
      [1.5, 12],
    ]),
  );
  add(LK.lance, drawRows(LANCE));
  add(LK.lanceEvo, drawRows(LANCE_EVO));
  add(LK.moon, drawRows(MOON));
  add(LK.moonEvo, drawRows(MOON_EVO));
  add(
    LK.spark,
    drawDot(2, [[1.5, 12]]),
  );
  add(LK.heal, drawRows(HEAL));
  add(LK.pull, drawRows(PULL));
  add(LK.blast, drawRows(BLAST));
  add(LK.chest, drawRows(CHEST));
  add(LK.post, drawRows(POST));
  add(LK.postLit, drawRows(POST_LIT));
  add(LK.heart, drawRows(withOutline(HEART)));
  add(LK.floor, drawFloor());
  add(LK.floorMarsh, drawMarshFloor());
  add(LK.floorRidge, drawRidgeFloor());
  add(LK.floorTundra, drawTundraFloor());
  for (const id of ICON_IDS) add(iconKey(id), drawRows(withOutline(ICONS[id])));
}
