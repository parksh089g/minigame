/**
 * 도감의 내용: 무기와 진화, 패시브, 그림자, 줍는 것.
 * 무기와 패시브는 처음부터 볼 수 있다. 그림자와 줍는 것은 판에서 한 번 만나야 열리고,
 * 진화형은 그 무기를 한 번 진화시켜야 이름과 설명이 보인다.
 * 화면을 그리는 일은 codexpage.ts가 맡고, 여기에는 글과 열리는 규칙만 둔다.
 */
import {
  CHEST,
  ELITE,
  ENEMIES,
  FLINT,
  GUARD,
  MAX_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  MID_BOSS_EVERY,
  PASSIVES,
  POSTS,
  RUN_SECONDS,
  STAGE_ORDER,
  STAGES,
  WEAPON_ORDER,
  WEAPONS,
  type EnemyKind,
  type PassiveId,
  type WeaponId,
} from './data';
import { formatClock } from './rules';

export type CodexTab = 'weapons' | 'passives' | 'foes' | 'finds';

export const CODEX_TABS: ReadonlyArray<{ id: CodexTab; name: string }> = [
  { id: 'weapons', name: '무기' },
  { id: 'passives', name: '패시브' },
  { id: 'foes', name: '그림자' },
  { id: 'finds', name: '줍는 것' },
];

/** 줍는 것과 등불 기둥의 이름. sim.ts가 만난 것을 적을 때 쓰는 이름과 같다. */
export type FindId = 'gem' | 'heal' | 'pull' | 'blast' | 'chest' | 'post';

export interface CodexEntry {
  /** 도감 안에서 하나뿐인 이름. 그림자는 EnemyKind, 진화형은 무기 이름에 Evo를 붙인 것이다. */
  id: string;
  tab: CodexTab;
  /** 그 쪽의 격자에서 몇 번째 줄에 놓이는지(0부터) */
  row: number;
  name: string;
  /** 이름 아래에 작게 적는 한 줄: 어디서 언제 나오는지 */
  note: string;
  /** 설명 */
  text: string;
  /** 열리는 조건. 없으면 처음부터 열려 있다. met은 판에서 만나야, evolved는 그 무기를 진화시켜야 열린다. */
  secret?: 'met' | 'evolved';
  /** 열리기 전에 설명 대신 보이는 글 */
  hint?: string;
}

/** 진화형의 도감 이름 */
export const evolvedId = (id: WeaponId): string => `${id}Evo`;

const FOE_TEXT: Readonly<Record<EnemyKind, string>> = {
  shade: '가장 흔한 그림자. 느리게 다가온다',
  bat: '약하지만 빠르게 날아든다',
  wisp: '제법 빠르고, 닿으면 아프다',
  brute: '느리지만 아주 튼튼하다',
  glare: '멀찍이 멈춰 서서 어둠 방울을 쏜다. 고리가 조여들면 옆으로 비키자',
  puff: '가까이 와서 부풀었다가 터진다. 바닥의 원 밖으로 나가면 다치지 않고, 둘레의 그림자는 함께 다친다',
  drip: '늪에서 가장 흔한 그림자. 느리게 다가온다',
  moth: '약하지만 아주 빠르게 날아든다',
  toad: '웅크렸다가 한 번에 뛰어든다. 뛰는 쪽은 뛰기 전에 정해진다',
  stump: '아주 느리고 아주 튼튼하다',
  squirt: '멀찍이 멈춰 서서 어둠 방울을 쏜다. 고리가 조여들면 옆으로 비키자',
  spore: '가까이 와서 부풀었다가 터진다. 바닥의 원 밖으로 나가면 다치지 않고, 둘레의 그림자는 함께 다친다',
  cinder: '고개에서 가장 흔한 그림자. 느리게 다가온다',
  soot: '약하지만 빠르게 날아든다',
  clinker: '쓰러지면 재방울 둘로 쪼개진다. 불구멍 위에서 쓰러뜨리면 함께 탄다',
  slag: '아주 느리고 아주 튼튼하다. 불구멍으로 끌어들이면 빨리 쓰러진다',
  smoker: '멀찍이 멈춰 서서 어둠 방울을 쏜다. 고리가 조여들면 옆으로 비키자',
  blister: '가까이 와서 부풀었다가 터진다. 바닥의 원 밖으로 나가면 다치지 않고, 둘레의 그림자는 함께 다친다',
  flake: '설원에서 가장 흔한 그림자. 느리게 다가오지만 돌풍이 불면 바람을 타고 날아든다',
  sleet: '약하지만 빠르게 날아든다. 돌풍에 가장 멀리 쓸려 간다',
  frost: '닿으면 발이 얼어 잠깐 느려진다. 빛막이 막아 주면 얼지 않는다',
  floe: '아주 느리고 아주 튼튼하다. 무거워서 돌풍에도 조금만 밀린다',
  hail: '멀찍이 멈춰 서서 어둠 방울을 쏜다. 고리가 조여들면 옆으로 비키자',
  bloat: '가까이 와서 부풀었다가 터진다. 바닥의 원 밖으로 나가면 다치지 않고, 둘레의 그림자는 함께 다친다',
  prowler: '크고 튼튼한 정예 그림자. 곧장 쫓아온다. 쓰러뜨리면 보물 상자를 떨어뜨린다',
  lurker: '크고 튼튼한 정예 그림자. 웅크렸다가 멀리 뛰어든다. 쓰러뜨리면 보물 상자를 떨어뜨린다',
  stoker: '느리지만 아주 튼튼한 정예 그림자. 닿으면 몹시 아프다. 쓰러뜨리면 보물 상자를 떨어뜨린다',
  fang: '크고 튼튼한 정예 그림자. 닿으면 발이 얼어 느려진다. 쓰러뜨리면 보물 상자를 떨어뜨린다',
  giant: '부하를 자꾸 불러낸다. 쓰러뜨리면 무기 강화권을 준다',
  ram: '힘을 모았다가 곧게 내달린다. 붉은 길에서 비키자. 쓰러뜨리면 무기 강화권을 준다',
  owl: '빛을 모았다가 부채꼴로 쏜다. 쓰러뜨리면 무기 강화권을 준다',
  lord: '내달리고 나서 부하를 부른다. 쓰러뜨리면 새벽이 온다',
  matron: '사방으로 쏘기와 부하 부르기를 번갈아 한다. 쓰러뜨리면 새벽이 온다',
  blizzard: '빛을 모았다가 사방으로 세 겹을 엇갈려 쏘고, 사이사이에 부하를 부른다. 겹마다 틈이 어긋나니 한 겹씩 지나가자. 쓰러뜨리면 새벽이 온다',
  warden: '내달린 다음에 빛을 모아 부채꼴로 쏜다. 붉은 길에서 비키고, 쏘면 옆으로 돌자. 쓰러뜨리면 새벽이 온다',
};

const FINDS: ReadonlyArray<{ id: FindId; name: string; note: string; text: string; hint?: string }> = [
  {
    id: 'gem',
    name: '빛 조각',
    note: '쓰러진 그림자가 남김',
    text: '모으면 레벨이 오르고, 오를 때마다 강화를 하나 고른다. 큰 조각일수록 많이 찬다',
  },
  {
    id: 'heal',
    name: '회복 떡',
    note: '드물게 떨어짐',
    text: '주우면 체력이 조금 찬다. 자석을 주워도 끌려오지 않아서, 필요할 때까지 아껴 둘 수 있다',
    hint: '쓰러진 그림자가 드물게 떨어뜨려요',
  },
  {
    id: 'pull',
    name: '자석',
    note: '아주 드물게 떨어짐',
    text: '주우면 싸움터에 흩어진 빛 조각이 멀리 있는 것까지 모두 끌려온다',
    hint: '쓰러진 그림자가 아주 드물게 떨어뜨려요',
  },
  {
    id: 'blast',
    name: '불꽃 단지',
    note: '아주 드물게 떨어짐',
    text: '주우면 화면 안의 그림자가 모두 쓰러진다. 보스는 조금만 다친다',
    hint: '쓰러진 그림자가 아주 드물게 떨어뜨려요',
  },
  {
    id: 'chest',
    name: '보물 상자',
    note: `정예 그림자가 떨어뜨림 · 한 판에 ${ELITE.times.length}개까지`,
    text: `주우면 가진 무기나 패시브 가운데 하나가 한 단계 오른다. 진화는 시키지 않고, 더 올릴 것이 없으면 불씨 ${CHEST.embers}개를 준다`,
    hint: '금빛 뿔이 난 정예 그림자를 쓰러뜨리면 떨어져요',
  },
  {
    id: 'post',
    name: '등불 기둥',
    note: `한 판에 ${POSTS.times.length}번 나타남`,
    text: `닿으면 ${POSTS.seconds}초 동안 켜져서 둘레의 그림자를 태우고 느리게 한다. 켜지 않고 두면 그 자리에 남아서, 밀물이 올 때까지 아껴 둘 수 있다`,
    hint: '판을 시작하고 조금 버티면 가까이에 서요',
  },
];

function passiveText(id: PassiveId): string {
  if (id === 'hood') {
    return `피해를 한 번 막는 빛막을 두른다. 깨지면 ${GUARD.seconds}초 뒤에 다시 생기고, 레벨마다 ${GUARD.perLevel}초씩 빨라진다`;
  }
  if (id === 'flint') {
    return `쓰러진 그림자가 가끔 터져서 둘레의 그림자를 다치게 한다. 튼튼한 그림자일수록 세게 터진다. 레벨마다 터질 확률 +${Math.round(FLINT.chance * 100)}%. 이렇게 쓰러진 그림자는 다시 터지지 않는다`;
  }
  return `레벨마다 ${PASSIVES[id].perLevel}`;
}

/** 도감의 격자 한 줄에 들어가는 칸 수. 화면 너비에 맞춘 값이다. */
export const CODEX_ROW_MAX = 7;

/**
 * count개를 한 줄에 CODEX_ROW_MAX개가 넘지 않게, 줄마다 비슷한 수로 나눠 놓을 때 index번째가 놓이는 줄.
 * 아홉 개는 일곱과 둘이 아니라 다섯과 넷으로 나뉜다.
 */
export function wrapRow(index: number, count: number): number {
  const rows = Math.max(1, Math.ceil(count / CODEX_ROW_MAX));
  return Math.floor(index / Math.ceil(count / rows));
}

function buildCodex(): CodexEntry[] {
  const entries: CodexEntry[] = [];
  const weaponCount = WEAPON_ORDER.length;
  // 무기가 차지하는 줄 수. 진화형은 그 아래에 같은 모양으로 놓여서, 무기와 그 진화형이 같은 자리에 온다.
  const weaponRows = wrapRow(weaponCount - 1, weaponCount) + 1;
  WEAPON_ORDER.forEach((id, index) => {
    const weapon = WEAPONS[id];
    entries.push({
      id,
      tab: 'weapons',
      row: wrapRow(index, weaponCount),
      name: weapon.name,
      note: `한 판에 ${MAX_WEAPONS}개까지 · ${MAX_LEVEL}레벨 뒤에 진화`,
      text: `${weapon.levels[0]}. 오를 때마다: ${weapon.levels.slice(1).join(' · ')}`,
    });
  });
  WEAPON_ORDER.forEach((id, index) => {
    const weapon = WEAPONS[id];
    entries.push({
      id: evolvedId(id),
      tab: 'weapons',
      row: weaponRows + wrapRow(index, weaponCount),
      name: weapon.evolved.name,
      note: `${weapon.name}의 진화`,
      text: weapon.evolved.description,
      secret: 'evolved',
      hint: `${MAX_LEVEL}레벨 ${weapon.name}에 무기 강화권을 쓰면 진화해요. 강화권은 중간 보스가 줘요`,
    });
  });
  const passiveIds = Object.keys(PASSIVES) as PassiveId[];
  passiveIds.forEach((id, index) => {
    entries.push({
      id,
      tab: 'passives',
      row: wrapRow(index, passiveIds.length),
      name: PASSIVES[id].name,
      note: `${MAX_LEVEL}레벨까지 · 한 판에 ${MAX_PASSIVES}개까지`,
      text: passiveText(id),
    });
  });
  // 그림자: 스테이지마다 한 줄(나오는 차례대로, 끝에 마지막 보스), 그 아래에 중간 보스 한 줄
  STAGE_ORDER.forEach((stageId, row) => {
    const stage = STAGES[stageId];
    for (const spawn of [...stage.spawns].sort((a, b) => a.from - b.from)) {
      entries.push({
        id: spawn.kind,
        tab: 'foes',
        row,
        name: ENEMIES[spawn.kind].name,
        note: `${stage.name} · ${spawn.from > 0 ? `${formatClock(spawn.from)}부터` : '처음부터'}`,
        text: FOE_TEXT[spawn.kind],
        secret: 'met',
        hint: `${stage.name}에서 ${spawn.from > 0 ? `${formatClock(spawn.from)}쯤부터` : '처음부터'} 나와요`,
      });
    }
    entries.push({
      id: stage.finalBoss,
      tab: 'foes',
      row,
      name: ENEMIES[stage.finalBoss].name,
      note: `${stage.name} · ${formatClock(RUN_SECONDS)}의 마지막 보스`,
      text: FOE_TEXT[stage.finalBoss],
      secret: 'met',
      hint: `${stage.name}에서 ${formatClock(RUN_SECONDS)}을 버티면 나타나요`,
    });
  });
  const midBosses: EnemyKind[] = [];
  for (const stageId of STAGE_ORDER) {
    for (const kind of STAGES[stageId].midBosses) if (!midBosses.includes(kind)) midBosses.push(kind);
  }
  for (const kind of midBosses) {
    entries.push({
      id: kind,
      tab: 'foes',
      row: STAGE_ORDER.length,
      name: ENEMIES[kind].name,
      note: `중간 보스 · ${MID_BOSS_EVERY / 60}분마다 하나씩`,
      text: FOE_TEXT[kind],
      secret: 'met',
      hint: `${MID_BOSS_EVERY / 60}분마다 하나씩 나오는 중간 보스예요`,
    });
  }
  // 정예 그림자는 중간 보스와 같은 줄에 놓는다.
  for (const stageId of STAGE_ORDER) {
    const stage = STAGES[stageId];
    entries.push({
      id: stage.elite,
      tab: 'foes',
      row: STAGE_ORDER.length,
      name: ENEMIES[stage.elite].name,
      note: `${stage.name}의 정예 · 한 판에 ${ELITE.times.length}번`,
      text: FOE_TEXT[stage.elite],
      secret: 'met',
      hint: `${stage.name}에서 ${formatClock(ELITE.times[0])}쯤부터 가끔 나오는 정예 그림자예요`,
    });
  }
  for (const find of FINDS) {
    entries.push({
      id: find.id,
      tab: 'finds',
      row: 0,
      name: find.name,
      note: find.note,
      text: find.text,
      ...(find.hint ? { secret: 'met' as const, hint: find.hint } : {}),
    });
  }
  return entries;
}

export const CODEX: readonly CodexEntry[] = buildCodex();

/** 도감의 모든 항목의 이름(늘어놓는 순서) */
export const CODEX_IDS: readonly string[] = CODEX.map((entry) => entry.id);

/** 판에서 만나야 열리는 항목의 이름. sim.ts가 적어 주는 이름 가운데 도감이 아는 것이다. */
export const MET_IDS: readonly string[] = CODEX.filter((entry) => entry.secret === 'met').map((entry) => entry.id);

export function entriesOf(tab: CodexTab): CodexEntry[] {
  return CODEX.filter((entry) => entry.tab === tab);
}

/** 도감이 열렸는지를 가리는 데 필요한 진행 기록 */
export interface CodexProgress {
  /** 만난 그림자와 주운 것 */
  codex: readonly string[];
  /** 새로 열렸는데 아직 들여다보지 않은 항목 */
  unread: readonly string[];
  stats: { evolved: readonly WeaponId[] };
}

export function isOpen(entry: CodexEntry, progress: CodexProgress): boolean {
  if (entry.secret === 'met') return progress.codex.includes(entry.id);
  if (entry.secret === 'evolved') return progress.stats.evolved.some((id) => evolvedId(id) === entry.id);
  return true;
}

/** 찾아야 열리는 항목 가운데 몇 개를 찾았는지. 처음부터 열려 있는 것은 세지 않는다. */
export function foundCount(progress: CodexProgress): { found: number; total: number } {
  const secrets = CODEX.filter((entry) => entry.secret);
  return { found: secrets.filter((entry) => isOpen(entry, progress)).length, total: secrets.length };
}

/** 아직 들여다보지 않은 항목이 그 쪽에 몇 개 있는지 */
export function unreadIn(tab: CodexTab, progress: CodexProgress): number {
  return entriesOf(tab).filter((entry) => progress.unread.includes(entry.id)).length;
}

/**
 * 한 판에서 만난 것(seen)과 그 판에서 진화해 있던 무기(evolved)를 도감에 적는다.
 * 새로 열린 항목은 들여다볼 때까지 unread에 남는다. before는 그 판을 반영하기 전의 기록이다.
 */
export function discover(
  before: CodexProgress,
  seen: readonly string[],
  evolved: readonly WeaponId[],
): { codex: string[]; unread: string[] } {
  const codex = MET_IDS.filter((id) => before.codex.includes(id) || seen.includes(id));
  const fresh = [
    ...codex.filter((id) => !before.codex.includes(id)),
    ...evolved.filter((id) => !before.stats.evolved.includes(id)).map(evolvedId),
  ];
  return { codex, unread: CODEX_IDS.filter((id) => before.unread.includes(id) || fresh.includes(id)) };
}

/** 저장된 도감 기록을 믿을 수 있는 모양으로 맞춘다. 모르는 이름은 버린다. */
export function normalizeCodex(codex: unknown, unread: unknown): { codex: string[]; unread: string[] } {
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    codex: MET_IDS.filter((id) => list(codex).includes(id)),
    unread: CODEX_IDS.filter((id) => list(unread).includes(id)),
  };
}
