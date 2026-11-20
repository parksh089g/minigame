/**
 * 구름 탑 모험의 정해진 값: 카드, 상태, 적과 만나는 무리, 보물, 영구 강화, 길에서 만나는 일.
 * 규칙(battle.ts, run.ts)과 화면이 같이 읽는다. Phaser에 기대지 않아서 테스트에서도 그대로 쓴다.
 *
 * 토끼 마법사가 카드로 싸우며 구름 탑을 한 층씩 오른다. 탑은 세 구역이고, 구역마다 일곱째 층에 대장이 있다.
 * 화면에 보이는 글은 글꼴(주아)에 들어 있는 완성형 한글만 쓴다. text.test.ts가 확인한다.
 */

export const TOWER_GAME_ID = 'cloud-tower';
export const TOWER_SCENE = 'CloudTower';

/** 구역마다 층 수. 마지막 층에 그 구역의 대장이 있다. */
export const FLOORS_PER_ACT = 7;
export const ACTS = 3;
export const TOP_FLOOR = FLOORS_PER_ACT * ACTS;

/** 구역의 이름. 갈림길 화면의 위쪽에 보인다. */
export const ACT_NAMES = ['구름 숲', '바람 골짜기', '별빛 꼭대기'] as const;

/** 처음 체력과 한 차례에 받는 마력, 뽑는 카드 수 */
export const PLAYER = { hp: 60, mana: 3, hand: 5, maxHand: 10 } as const;

// ───────── 상태 ─────────

export type StatusId =
  | 'strength'
  | 'tough'
  | 'vuln'
  | 'weak'
  | 'poison'
  | 'thorns'
  | 'guard'
  | 'growth'
  | 'busy'
  | 'toxin'
  | 'pump';

export interface StatusDef {
  name: string;
  /** 설명. n이 그 상태의 값이다. */
  blurb: (n: number) => string;
  /** 좋은 상태인지(아이콘의 바탕색이 다르다) */
  good: boolean;
  /** 주인의 차례가 끝날 때 1씩 줄어드는 상태 */
  fades?: boolean;
}

export const STATUSES: Readonly<Record<StatusId, StatusDef>> = {
  strength: { name: '힘', blurb: (n) => `공격 피해가 ${n} 늘어요`, good: true },
  tough: { name: '단단함', blurb: (n) => `카드로 얻는 방어가 ${n} 늘어요`, good: true },
  vuln: { name: '허점', blurb: (n) => `받는 피해가 절반 더 늘어요. ${n}차례 남음`, good: false, fades: true },
  weak: { name: '움츠림', blurb: (n) => `주는 피해가 4분의 1 줄어요. ${n}차례 남음`, good: false, fades: true },
  poison: { name: '독', blurb: (n) => `차례가 올 때 독만큼 체력을 잃고 독이 1 줄어요. 지금 ${n}`, good: false },
  thorns: { name: '가시', blurb: (n) => `나를 때린 상대가 피해 ${n}`, good: true },
  guard: { name: '껍질', blurb: (n) => `차례가 올 때마다 방어 ${n}`, good: true },
  growth: { name: '자람', blurb: (n) => `차례가 올 때마다 힘 +${n}`, good: true },
  busy: { name: '바쁜 손', blurb: (n) => `차례마다 카드를 ${n}장 더 뽑아요`, good: true },
  toxin: { name: '독안개', blurb: (n) => `차례가 올 때마다 모든 적에게 독 ${n}`, good: true },
  pump: { name: '두근두근', blurb: (n) => `차례마다 마력 +${n}`, good: true },
};

/** 상태를 보여 주는 차례 */
export const STATUS_ORDER = Object.keys(STATUSES) as StatusId[];

// ───────── 카드 ─────────

/**
 * 카드(와 적의 행동)가 하는 일 하나.
 * 카드를 낼 때는 hit/give가 고른 적에게, hitAll/giveAll이 모든 적에게, block/gain/heal이 나에게 간다.
 * 적이 할 때는 hit/give가 토끼에게, block/gain/heal이 그 적 자신에게, shieldAll이 모든 적에게 간다.
 */
export type Act =
  | { k: 'hit'; n: number; times?: number }
  | { k: 'hitAll'; n: number; times?: number }
  /** 지금 가진 방어만큼 피해 */
  | { k: 'hitBlock' }
  | { k: 'block'; n: number }
  | { k: 'shieldAll'; n: number }
  | { k: 'draw'; n: number }
  | { k: 'mana'; n: number }
  | { k: 'heal'; n: number }
  | { k: 'lose'; n: number }
  | { k: 'give'; s: StatusId; n: number }
  | { k: 'giveAll'; s: StatusId; n: number }
  | { k: 'gain'; s: StatusId; n: number }
  /** 고른 적의 독을 두 배로 */
  | { k: 'doublePoison' };

export type CardType = 'attack' | 'skill' | 'power';
export type Rarity = 'start' | 'common' | 'uncommon' | 'rare';

export interface CardDef {
  name: string;
  type: CardType;
  rarity: Rarity;
  /** 0이면 처음부터 나오고, 1과 2는 영구 강화로 새 카드 묶음을 열어야 나온다. */
  pack: 0 | 1 | 2;
  /** [보통, 강화] */
  cost: readonly [number, number];
  acts: readonly [readonly Act[], readonly Act[]];
  /** 내고 나면 이번 싸움에서 사라지는지. [보통, 강화] */
  vanish?: readonly [boolean, boolean];
}

const hit = (n: number, times?: number): Act => (times ? { k: 'hit', n, times } : { k: 'hit', n });
const hitAll = (n: number, times?: number): Act => (times ? { k: 'hitAll', n, times } : { k: 'hitAll', n });
const block = (n: number): Act => ({ k: 'block', n });
const draw = (n: number): Act => ({ k: 'draw', n });
const mana = (n: number): Act => ({ k: 'mana', n });
const heal = (n: number): Act => ({ k: 'heal', n });
const give = (s: StatusId, n: number): Act => ({ k: 'give', s, n });
const giveAll = (s: StatusId, n: number): Act => ({ k: 'giveAll', s, n });
const gain = (s: StatusId, n: number): Act => ({ k: 'gain', s, n });

const CARD_DATA = {
  // 처음 덱
  wand: { name: '별똥 지팡이', type: 'attack', rarity: 'start', pack: 0, cost: [1, 1], acts: [[hit(6)], [hit(9)]] },
  cloud: { name: '구름 방패', type: 'skill', rarity: 'start', pack: 0, cost: [1, 1], acts: [[block(5)], [block(8)]] },
  popper: {
    name: '반짝 폭죽',
    type: 'attack',
    rarity: 'start',
    pack: 0,
    cost: [2, 2],
    acts: [
      [hit(8), give('vuln', 2)],
      [hit(10), give('vuln', 3)],
    ],
  },

  // 흔한 카드
  twins: { name: '쌍둥이 별', type: 'attack', rarity: 'common', pack: 0, cost: [1, 1], acts: [[hit(4, 2)], [hit(6, 2)]] },
  whirl: { name: '회오리', type: 'attack', rarity: 'common', pack: 0, cost: [1, 1], acts: [[hitAll(6)], [hitAll(9)]] },
  bean: { name: '묵직한 콩', type: 'attack', rarity: 'common', pack: 0, cost: [2, 2], acts: [[hit(14)], [hit(19)]] },
  needle: {
    name: '따끔 바늘',
    type: 'attack',
    rarity: 'common',
    pack: 0,
    cost: [1, 1],
    acts: [
      [hit(4), give('poison', 3)],
      [hit(5), give('poison', 5)],
    ],
  },
  breeze: {
    name: '꽁꽁 바람',
    type: 'attack',
    rarity: 'common',
    pack: 0,
    cost: [1, 1],
    acts: [
      [hit(7), give('weak', 1)],
      [hit(9), give('weak', 2)],
    ],
  },
  ball: {
    name: '통통 공',
    type: 'attack',
    rarity: 'common',
    pack: 0,
    cost: [0, 0],
    acts: [
      [hit(3), draw(1)],
      [hit(5), draw(1)],
    ],
  },
  shove: { name: '방패 밀치기', type: 'attack', rarity: 'common', pack: 0, cost: [1, 0], acts: [[{ k: 'hitBlock' }], [{ k: 'hitBlock' }]] },
  shell: { name: '단단 껍질', type: 'skill', rarity: 'common', pack: 0, cost: [1, 1], acts: [[block(8)], [block(11)]] },
  dash: {
    name: '날쌘 발',
    type: 'skill',
    rarity: 'common',
    pack: 0,
    cost: [1, 1],
    acts: [
      [block(5), draw(1)],
      [block(7), draw(1)],
    ],
  },
  think: { name: '생각 구름', type: 'skill', rarity: 'common', pack: 0, cost: [1, 1], acts: [[draw(2)], [draw(3)]] },
  sparkle: {
    name: '별빛 한 줌',
    type: 'skill',
    rarity: 'common',
    pack: 0,
    cost: [0, 0],
    acts: [[mana(1)], [mana(2)]],
    vanish: [true, true],
  },
  sleepy: {
    name: '졸음 가루',
    type: 'skill',
    rarity: 'common',
    pack: 0,
    cost: [1, 1],
    acts: [[giveAll('weak', 2)], [giveAll('weak', 3)]],
  },
  spore: { name: '독버섯 포자', type: 'skill', rarity: 'common', pack: 0, cost: [1, 1], acts: [[give('poison', 5)], [give('poison', 8)]] },
  herb: { name: '치료 약초', type: 'skill', rarity: 'common', pack: 0, cost: [1, 1], acts: [[heal(4)], [heal(7)]], vanish: [true, true] },

  // 가끔 나오는 카드
  rainbow: { name: '무지개 화살', type: 'attack', rarity: 'uncommon', pack: 0, cost: [2, 2], acts: [[hit(4, 4)], [hit(5, 4)]] },
  flurry: { name: '몰아치기', type: 'attack', rarity: 'uncommon', pack: 0, cost: [1, 1], acts: [[hit(3, 3)], [hit(4, 3)]] },
  thunder: {
    name: '번쩍 번개',
    type: 'attack',
    rarity: 'uncommon',
    pack: 0,
    cost: [2, 2],
    acts: [
      [hitAll(10), giveAll('vuln', 1)],
      [hitAll(14), giveAll('vuln', 1)],
    ],
  },
  wall: { name: '큰 방패', type: 'skill', rarity: 'uncommon', pack: 0, cost: [2, 2], acts: [[block(15)], [block(20)]] },
  stance: {
    name: '버티기 자세',
    type: 'skill',
    rarity: 'uncommon',
    pack: 0,
    cost: [1, 1],
    acts: [
      [block(6), gain('tough', 1)],
      [block(8), gain('tough', 2)],
    ],
  },
  double: { name: '독 두 배', type: 'skill', rarity: 'uncommon', pack: 0, cost: [1, 0], acts: [[{ k: 'doublePoison' }], [{ k: 'doublePoison' }]] },
  breath: { name: '깊은 숨', type: 'skill', rarity: 'uncommon', pack: 0, cost: [1, 0], acts: [[mana(2)], [mana(2)]], vanish: [true, true] },
  cheer: { name: '힘내기', type: 'power', rarity: 'uncommon', pack: 0, cost: [1, 1], acts: [[gain('strength', 2)], [gain('strength', 3)]] },
  armor: { name: '껍질 키우기', type: 'power', rarity: 'uncommon', pack: 0, cost: [1, 1], acts: [[gain('guard', 4)], [gain('guard', 6)]] },
  bramble: { name: '가시 덩굴', type: 'power', rarity: 'uncommon', pack: 0, cost: [1, 1], acts: [[gain('thorns', 3)], [gain('thorns', 5)]] },

  // 드문 카드
  meteor: { name: '유성우', type: 'attack', rarity: 'rare', pack: 0, cost: [3, 3], acts: [[hitAll(7, 3)], [hitAll(9, 3)]] },
  bubble: { name: '무적 방울', type: 'skill', rarity: 'rare', pack: 0, cost: [2, 2], acts: [[block(30)], [block(40)]], vanish: [true, true] },
  song: { name: '별의 노래', type: 'power', rarity: 'rare', pack: 0, cost: [3, 2], acts: [[gain('growth', 1)], [gain('growth', 1)]] },
  hands: { name: '바쁜 손', type: 'power', rarity: 'rare', pack: 0, cost: [1, 0], acts: [[gain('busy', 1)], [gain('busy', 1)]] },
  fog: { name: '독안개', type: 'power', rarity: 'rare', pack: 0, cost: [2, 2], acts: [[gain('toxin', 2)], [gain('toxin', 3)]] },

  // 새 카드 묶음 1
  tea: {
    name: '따뜻한 차',
    type: 'skill',
    rarity: 'common',
    pack: 1,
    cost: [0, 0],
    acts: [
      [heal(3), draw(1)],
      [heal(5), draw(1)],
    ],
    vanish: [true, true],
  },
  mirror: {
    name: '거울 방패',
    type: 'skill',
    rarity: 'common',
    pack: 1,
    cost: [1, 1],
    acts: [
      [block(7), gain('thorns', 1)],
      [block(10), gain('thorns', 2)],
    ],
  },
  blade: { name: '바람 칼날', type: 'attack', rarity: 'common', pack: 1, cost: [0, 0], acts: [[hitAll(4)], [hitAll(6)]] },
  hammer: {
    name: '흔들 망치',
    type: 'attack',
    rarity: 'uncommon',
    pack: 1,
    cost: [2, 2],
    acts: [
      [hit(12), give('vuln', 2)],
      [hit(16), give('vuln', 3)],
    ],
  },
  gather: { name: '별 모으기', type: 'skill', rarity: 'uncommon', pack: 1, cost: [1, 1], acts: [[draw(3)], [draw(4)]], vanish: [true, false] },
  moon: { name: '달빛 갑옷', type: 'power', rarity: 'rare', pack: 1, cost: [2, 2], acts: [[gain('tough', 2)], [gain('tough', 3)]] },

  // 새 카드 묶음 2
  pillow: {
    name: '구름 쿠션',
    type: 'skill',
    rarity: 'common',
    pack: 2,
    cost: [1, 1],
    acts: [
      [block(6), giveAll('weak', 1)],
      [block(8), giveAll('weak', 2)],
    ],
  },
  pollen: { name: '꽃가루 폭풍', type: 'skill', rarity: 'uncommon', pack: 2, cost: [2, 2], acts: [[giveAll('poison', 6)], [giveAll('poison', 9)]] },
  heart: { name: '두근두근', type: 'power', rarity: 'rare', pack: 2, cost: [3, 2], acts: [[gain('pump', 1)], [gain('pump', 1)]] },
  finale: { name: '큰 한 방', type: 'attack', rarity: 'rare', pack: 2, cost: [3, 3], acts: [[hit(30)], [hit(40)]], vanish: [true, true] },
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARD_DATA;
export const CARDS: Readonly<Record<CardId, CardDef>> = CARD_DATA;
export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function cardDef(id: CardId): CardDef {
  return CARDS[id];
}

/** 처음 덱: 지팡이 다섯, 방패 넷, 폭죽 하나 */
export const START_DECK: readonly CardId[] = ['wand', 'wand', 'wand', 'wand', 'wand', 'cloud', 'cloud', 'cloud', 'cloud', 'popper'];

export const CARD_TYPE_NAME: Readonly<Record<CardType, string>> = { attack: '공격', skill: '기술', power: '마법' };
export const RARITY_NAME: Readonly<Record<Rarity, string>> = { start: '기본', common: '흔함', uncommon: '귀함', rare: '아주 귀함' };

// ───────── 적 ─────────

export interface EnemyMove {
  /** 무엇을 하는지 한 낱말. 적을 누르면 보인다. */
  name: string;
  acts: readonly Act[];
}

export type EnemyLook =
  | 'jelly'
  | 'squirrel'
  | 'chestnut'
  | 'crow'
  | 'mushroom'
  | 'sheep'
  | 'fox'
  | 'penguin'
  | 'turtle'
  | 'bee'
  | 'bear'
  | 'owl'
  | 'jellyfish'
  | 'cat'
  | 'clock'
  | 'whale';

export interface EnemyDef {
  name: string;
  look: EnemyLook;
  /** 체력의 [가장 적게, 가장 많이] */
  hp: readonly [number, number];
  moves: readonly EnemyMove[];
  /** cycle이면 적힌 차례대로 돌고, random이면 같은 행동을 세 번 잇지 않게 무작위로 고른다. */
  pattern: 'cycle' | 'random';
  /** 싸움을 시작할 때 가진 상태 */
  start?: Partial<Record<StatusId, number>>;
  /** 그림의 크기(1이 보통) */
  size?: number;
}

export type EnemyId =
  | 'jelly'
  | 'squirrel'
  | 'chestnut'
  | 'crow'
  | 'knight'
  | 'ram'
  | 'fox'
  | 'penguin'
  | 'turtle'
  | 'bees'
  | 'teddy'
  | 'owl'
  | 'jellyfish'
  | 'cat'
  | 'clock'
  | 'whale';

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  // 구름 숲
  jelly: {
    name: '말랑 젤리',
    look: 'jelly',
    hp: [16, 20],
    pattern: 'random',
    moves: [
      { name: '몸통 박치기', acts: [hit(6)] },
      { name: '끈적끈적', acts: [hit(3), give('weak', 1)] },
    ],
  },
  squirrel: {
    name: '심술 다람쥐',
    look: 'squirrel',
    hp: [12, 15],
    pattern: 'random',
    moves: [
      { name: '도토리 던지기', acts: [hit(3, 2)] },
      { name: '할퀴기', acts: [hit(5)] },
      { name: '볼 부풀리기', acts: [block(5), gain('strength', 1)] },
    ],
  },
  chestnut: {
    name: '가시 밤송이',
    look: 'chestnut',
    hp: [20, 24],
    pattern: 'cycle',
    start: { thorns: 2 },
    moves: [
      { name: '데굴데굴', acts: [hit(7)] },
      { name: '웅크리기', acts: [block(7)] },
      { name: '데굴데굴', acts: [hit(8)] },
    ],
  },
  crow: {
    name: '꼬마 까마귀',
    look: 'crow',
    hp: [10, 13],
    pattern: 'random',
    moves: [
      { name: '쪼기', acts: [hit(4)] },
      { name: '깍깍', acts: [hit(2), give('vuln', 1)] },
    ],
  },
  knight: {
    name: '버섯 기사',
    look: 'mushroom',
    hp: [44, 48],
    pattern: 'cycle',
    size: 1.25,
    moves: [
      { name: '버섯 방패', acts: [block(10), hit(7)] },
      { name: '포자 뿌리기', acts: [give('poison', 3), give('weak', 1)] },
      { name: '크게 휘두르기', acts: [hit(15)] },
    ],
  },
  ram: {
    name: '천둥 양',
    look: 'sheep',
    hp: [88, 88],
    pattern: 'cycle',
    size: 1.45,
    moves: [
      { name: '털 부풀리기', acts: [block(12), gain('strength', 2)] },
      { name: '번개 박치기', acts: [hit(11)] },
      { name: '우르릉', acts: [hit(4, 3)] },
      { name: '정전기', acts: [hit(6), give('vuln', 2)] },
    ],
  },

  // 바람 골짜기
  fox: {
    name: '바람 여우',
    look: 'fox',
    hp: [30, 34],
    pattern: 'random',
    moves: [
      { name: '두 번 할퀴기', acts: [hit(6, 2)] },
      { name: '살랑살랑', acts: [block(8), give('weak', 1)] },
      { name: '덮치기', acts: [hit(11)] },
    ],
  },
  penguin: {
    name: '얼음 펭귄',
    look: 'penguin',
    hp: [36, 40],
    pattern: 'cycle',
    moves: [
      { name: '미끄러지기', acts: [hit(10)] },
      { name: '얼음 갑옷', acts: [block(12)] },
      { name: '눈뭉치', acts: [hit(6), give('weak', 2)] },
    ],
  },
  turtle: {
    name: '돌 거북',
    look: 'turtle',
    hp: [40, 44],
    pattern: 'cycle',
    start: { guard: 4 },
    moves: [
      { name: '쿵', acts: [hit(12)] },
      { name: '목 넣기', acts: [block(10), gain('strength', 2)] },
    ],
  },
  bees: {
    name: '꿀벌 떼',
    look: 'bee',
    hp: [22, 26],
    pattern: 'random',
    moves: [
      { name: '벌침 세례', acts: [hit(2, 4)] },
      { name: '윙윙', acts: [give('poison', 3)] },
    ],
  },
  teddy: {
    name: '화난 곰 인형',
    look: 'bear',
    hp: [88, 92],
    pattern: 'cycle',
    size: 1.3,
    moves: [
      { name: '솜 주먹', acts: [hit(9, 2)] },
      { name: '실밥 꿰매기', acts: [block(14), { k: 'heal', n: 8 }] },
      { name: '버럭!', acts: [gain('strength', 3), give('vuln', 2)] },
      { name: '와락 껴안기', acts: [hit(22)] },
    ],
  },
  owl: {
    name: '밤 부엉이',
    look: 'owl',
    hp: [170, 170],
    pattern: 'cycle',
    size: 1.45,
    moves: [
      { name: '날개 펴기', acts: [{ k: 'shieldAll', n: 16 }, gain('strength', 2)] },
      { name: '부리 쪼기', acts: [hit(7, 3)] },
      { name: '부엉부엉', acts: [give('weak', 2), give('vuln', 2)] },
      { name: '급강하', acts: [hit(24)] },
    ],
  },

  // 별빛 꼭대기
  jellyfish: {
    name: '별 해파리',
    look: 'jellyfish',
    hp: [48, 54],
    pattern: 'random',
    moves: [
      { name: '찌릿찌릿', acts: [hit(9), give('poison', 3)] },
      { name: '둥실둥실', acts: [block(14), { k: 'heal', n: 6 }] },
      { name: '촉수 휘감기', acts: [hit(5, 3)] },
    ],
  },
  cat: {
    name: '그림자 고양이',
    look: 'cat',
    hp: [44, 50],
    pattern: 'random',
    moves: [
      { name: '발톱 세 번', acts: [hit(6, 3)] },
      { name: '숨어들기', acts: [block(16), gain('strength', 2)] },
      { name: '야옹', acts: [give('vuln', 2), hit(8)] },
    ],
  },
  clock: {
    name: '시계 토끼',
    look: 'clock',
    hp: [120, 126],
    pattern: 'cycle',
    size: 1.3,
    moves: [
      { name: '째깍', acts: [hit(8, 2)] },
      { name: '태엽 감기', acts: [block(18), gain('strength', 3)] },
      { name: '시간 비틀기', acts: [give('weak', 2), give('vuln', 2), hit(6)] },
      { name: '땡땡땡', acts: [hit(9, 3)] },
    ],
  },
  whale: {
    name: '꿈 고래',
    look: 'whale',
    hp: [260, 260],
    pattern: 'cycle',
    size: 1.6,
    start: { guard: 6 },
    moves: [
      { name: '물 뿜기', acts: [hit(12, 2)] },
      { name: '꿈꾸기', acts: [{ k: 'heal', n: 16 }, gain('strength', 3)] },
      { name: '큰 파도', acts: [hit(30)] },
      { name: '자장가', acts: [give('weak', 2), give('poison', 5), block(20)] },
      { name: '별 노래', acts: [hit(6, 4)] },
    ],
  },
};

/** 구역마다 만나는 무리. 앞의 둘은 그 구역의 첫 싸움들에 나오는 쉬운 무리다. */
export const ENCOUNTERS: Readonly<{
  easy: readonly (readonly EnemyId[])[];
  normal: readonly (readonly EnemyId[])[];
  elite: readonly (readonly EnemyId[])[];
  boss: EnemyId;
}>[] = [
  {
    easy: [['jelly'], ['crow', 'crow'], ['squirrel']],
    normal: [['jelly', 'squirrel'], ['chestnut'], ['crow', 'crow', 'squirrel'], ['chestnut', 'crow'], ['jelly', 'jelly']],
    elite: [['knight'], ['chestnut', 'chestnut', 'jelly']],
    boss: 'ram',
  },
  {
    easy: [['fox'], ['penguin'], ['bees', 'crow']],
    normal: [['fox', 'bees'], ['turtle'], ['penguin', 'bees'], ['fox', 'fox'], ['turtle', 'crow', 'crow']],
    elite: [['teddy'], ['turtle', 'penguin', 'bees']],
    boss: 'owl',
  },
  {
    easy: [['jellyfish'], ['cat']],
    normal: [['jellyfish', 'cat'], ['cat', 'bees', 'bees'], ['jellyfish', 'jellyfish'], ['turtle', 'cat'], ['fox', 'jellyfish', 'fox']],
    elite: [['clock'], ['cat', 'cat', 'penguin']],
    boss: 'whale',
  },
];

// ───────── 보물 ─────────

export type TreasureId =
  | 'cushion'
  | 'badge'
  | 'ribbon'
  | 'hourglass'
  | 'candy'
  | 'glove'
  | 'piggy'
  | 'clover'
  | 'feather'
  | 'honey'
  | 'pouch'
  | 'kettle'
  | 'bigStar'
  | 'sleepyMoon'
  | 'marble';

export interface TreasureDef {
  name: string;
  blurb: string;
  /** 대장을 물리치면 고르는 보물. 차례마다 마력이 늘지만 대가가 있다. */
  boss?: boolean;
}

export const TREASURES: Readonly<Record<TreasureId, TreasureDef>> = {
  cushion: { name: '솜사탕 방석', blurb: '싸움에서 이기면 체력 6 회복' },
  badge: { name: '방패 배지', blurb: '싸움의 첫 차례에 방어 10' },
  ribbon: { name: '빨간 리본', blurb: '싸움을 시작할 때 힘 +1' },
  hourglass: { name: '모래시계', blurb: '싸움의 첫 차례에 카드 2장 더' },
  candy: { name: '반짝 사탕', blurb: '싸움의 첫 차례에 마력 +1' },
  glove: { name: '가시 장갑', blurb: '싸움을 시작할 때 가시 3' },
  piggy: { name: '돼지 저금통', blurb: '싸움에서 이기면 별사탕 12개 더' },
  clover: { name: '네잎클로버', blurb: '공격 카드 3장마다 카드 1장 뽑기' },
  feather: { name: '깃털 이불', blurb: '차례를 마칠 때 방어가 없으면 방어 5' },
  honey: { name: '꿀단지', blurb: '얻을 때 최대 체력 +10' },
  pouch: { name: '포자 주머니', blurb: '싸움을 시작할 때 모든 적에게 독 3' },
  kettle: { name: '작은 주전자', blurb: '체력이 절반 아래가 되면 한 번 12 회복' },
  bigStar: { name: '큰 별', blurb: '차례마다 마력 +1. 카드 보상의 가짓수가 하나 줄어요', boss: true },
  sleepyMoon: { name: '졸린 달', blurb: '차례마다 마력 +1. 쉼터에서 쉴 수 없어요', boss: true },
  marble: { name: '무지개 구슬', blurb: '차례마다 마력 +1. 싸움을 시작할 때 움츠림 2', boss: true },
};

export const TREASURE_IDS = Object.keys(TREASURES) as TreasureId[];
export const COMMON_TREASURES = TREASURE_IDS.filter((id) => !TREASURES[id].boss);
export const BOSS_TREASURES = TREASURE_IDS.filter((id) => TREASURES[id].boss === true);

// ───────── 갈림길 ─────────

export type NodeKind = 'fight' | 'elite' | 'rest' | 'shop' | 'chest' | 'event' | 'boss';

export const NODE_NAMES: Readonly<Record<NodeKind, string>> = {
  fight: '싸움',
  elite: '강한 적',
  rest: '쉼터',
  shop: '가게',
  chest: '보물 상자',
  event: '수상한 길',
  boss: '대장',
};

export const NODE_BLURBS: Readonly<Record<NodeKind, string>> = {
  fight: '적을 물리치고 카드를 얻어요',
  elite: '아주 세지만 보물을 줘요',
  rest: '쉬거나 카드를 강화해요',
  shop: '별사탕으로 카드와 보물을 사요',
  chest: '보물을 하나 얻어요',
  event: '무슨 일이 생길까요?',
  boss: '이 구역의 대장이에요',
};

// ───────── 길에서 만나는 일 ─────────

export type EventId = 'spring' | 'cat' | 'books' | 'mushrooms' | 'gardener';

/** 고를 수 있는 것 하나. 하는 일은 run.ts의 applyEventChoice가 맡는다. */
export interface EventChoice {
  label: string;
  /** 고르면 무엇이 되는지 한 줄 */
  note: string;
}

export interface EventDef {
  title: string;
  story: string;
  choices: readonly EventChoice[];
}

export const EVENTS: Readonly<Record<EventId, EventDef>> = {
  spring: {
    title: '반짝이는 샘',
    story: '맑은 샘물이 반짝여요.\n바닥에 동전이 잔뜩 깔려 있어요.',
    choices: [
      { label: '물 마시기', note: '최대 체력의 4분의 1 회복' },
      { label: '소원 빌기', note: '별사탕 30개를 내고 보물 하나' },
    ],
  },
  cat: {
    title: '길 잃은 상인 고양이',
    story: '짐이 너무 무거운 고양이가\n도와 달라고 해요.',
    choices: [
      { label: '짐 들어 주기', note: '체력 8 잃고 별사탕 50개' },
      { label: '물건 구경하기', note: '귀한 카드 한 장 받기' },
    ],
  },
  books: {
    title: '낡은 책장',
    story: '먼지 쌓인 마법책이 꽂혀 있어요.',
    choices: [
      { label: '책 읽기', note: '덱의 카드 2장을 무작위로 강화' },
      { label: '그냥 가기', note: '아무 일도 없어요' },
    ],
  },
  mushrooms: {
    title: '알록달록 버섯',
    story: '처음 보는 버섯이 자라 있어요.\n먹어도 될까요?',
    choices: [
      { label: '먹어 보기', note: '체력 6 잃고 최대 체력 +6' },
      { label: '지나가기', note: '아무 일도 없어요' },
    ],
  },
  gardener: {
    title: '구름 정원사',
    story: '정원사가 덱을 다듬어 주겠대요.',
    choices: [
      { label: '카드 빼기', note: '덱에서 카드 한 장 빼기' },
      { label: '지나가기', note: '아무 일도 없어요' },
    ],
  },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

// ───────── 영구 강화 ─────────

export type UpgradeId = 'hp' | 'gold' | 'rest' | 'choice' | 'relic' | 'pack1' | 'pack2';

export interface UpgradeDef {
  name: string;
  blurb: string;
  /** 단계마다의 값(구름 조각). 길이가 가장 높은 단계다. */
  costs: readonly number[];
  /** 그 단계에서의 효과를 한 줄로 */
  effect: (level: number) => string;
}

export const UPGRADES: Readonly<Record<UpgradeId, UpgradeDef>> = {
  hp: {
    name: '튼튼한 몸',
    blurb: '처음 최대 체력이 단계마다 5 늘어요',
    costs: [10, 20, 35, 55],
    effect: (level) => `최대 체력 +${level * 5}`,
  },
  gold: {
    name: '두둑한 주머니',
    blurb: '별사탕을 단계마다 30개 더 들고 출발해요',
    costs: [8, 18, 30],
    effect: (level) => `별사탕 +${level * 30}`,
  },
  rest: {
    name: '포근한 이불',
    blurb: '쉼터에서 쉴 때 회복이 단계마다 10% 늘어요',
    costs: [15, 30],
    effect: (level) => `쉬기 ${30 + level * 10}% 회복`,
  },
  choice: {
    name: '넓은 눈',
    blurb: '카드 보상에서 4장 가운데 골라요',
    costs: [40],
    effect: (level) => (level > 0 ? '카드 보상 4장' : '카드 보상 3장'),
  },
  relic: {
    name: '행운의 시작',
    blurb: '무작위 보물 하나를 들고 출발해요',
    costs: [45],
    effect: (level) => (level > 0 ? '보물 들고 출발' : '아직 없음'),
  },
  pack1: {
    name: '새 카드 묶음 1',
    blurb: '따뜻한 차, 흔들 망치 같은 카드 6장이 나와요',
    costs: [25],
    effect: (level) => (level > 0 ? '열림' : '닫힘'),
  },
  pack2: {
    name: '새 카드 묶음 2',
    blurb: '두근두근, 큰 한 방 같은 카드 4장이 나와요',
    costs: [60],
    effect: (level) => (level > 0 ? '열림' : '닫힘'),
  },
};

export const UPGRADE_ORDER: readonly UpgradeId[] = ['hp', 'gold', 'rest', 'pack1', 'choice', 'relic', 'pack2'];

/** 값들. 상점과 보상, 점수가 쓴다. */
export const PRICES = {
  card: { start: 40, common: 45, uncommon: 70, rare: 130 },
  treasure: 140,
  /** 가게에서 카드를 빼는 값. 뺄 때마다 이만큼 오른다. */
  remove: 60,
  removeStep: 25,
} as const;

export const REWARD = {
  /** 싸움에서 이기면 받는 별사탕의 [가장 적게, 가장 많이] */
  fight: [12, 18],
  elite: [28, 36],
  boss: [70, 80],
  /** 쉼터에서 쉬면 최대 체력의 이만큼(%) 회복 */
  restPercent: 30,
} as const;
