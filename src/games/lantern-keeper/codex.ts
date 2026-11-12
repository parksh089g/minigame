/**
 * 도감의 내용: 무기와 진화, 패시브, 그림자, 줍는 것.
 * 무기와 패시브는 처음부터 볼 수 있다. 그림자와 줍는 것은 판에서 한 번 만나야 열리고,
 * 진화형은 그 무기를 한 번 진화시켜야 이름과 설명이 보인다.
 * 화면을 그리는 일은 codexpage.ts가 맡고, 여기에는 글과 열리는 규칙만 둔다.
 */
import {
  ENEMIES,
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
export type FindId = 'gem' | 'heal' | 'pull' | 'blast' | 'post';

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
  giant: '부하를 자꾸 불러낸다. 쓰러뜨리면 무기 강화권을 준다',
  ram: '힘을 모았다가 곧게 내달린다. 붉은 길에서 비키자. 쓰러뜨리면 무기 강화권을 준다',
  owl: '빛을 모았다가 부채꼴로 쏜다. 쓰러뜨리면 무기 강화권을 준다',
  lord: '내달리고 나서 부하를 부른다. 쓰러뜨리면 새벽이 온다',
  matron: '사방으로 쏘기와 부하 부르기를 번갈아 한다. 쓰러뜨리면 새벽이 온다',
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
  return `레벨마다 ${PASSIVES[id].perLevel}`;
}

function buildCodex(): CodexEntry[] {
  const entries: CodexEntry[] = [];
  for (const id of WEAPON_ORDER) {
    const weapon = WEAPONS[id];
    entries.push({
      id,
      tab: 'weapons',
      row: 0,
      name: weapon.name,
      note: `한 판에 ${MAX_WEAPONS}개까지 · ${MAX_LEVEL}레벨 뒤에 진화`,
      text: `${weapon.levels[0]}. 오를 때마다: ${weapon.levels.slice(1).join(' · ')}`,
    });
  }
  for (const id of WEAPON_ORDER) {
    const weapon = WEAPONS[id];
    entries.push({
      id: evolvedId(id),
      tab: 'weapons',
      row: 1,
      name: weapon.evolved.name,
      note: `${weapon.name}의 진화`,
      text: weapon.evolved.description,
      secret: 'evolved',
      hint: `${MAX_LEVEL}레벨 ${weapon.name}에 무기 강화권을 쓰면 진화해요. 강화권은 중간 보스가 줘요`,
    });
  }
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    entries.push({
      id,
      tab: 'passives',
      row: 0,
      name: PASSIVES[id].name,
      note: `${MAX_LEVEL}레벨까지 · 한 판에 ${MAX_PASSIVES}개까지`,
      text: passiveText(id),
    });
  }
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
