/**
 * 준비 화면의 오늘의 판 쪽: 오늘 누구나 같은 조건으로 하는 판의 규칙과 오늘의 기록을 보여 주고, 거기서 바로 시작한다.
 * 오늘의 랭킹 쪽(rank-page.ts)으로 가는 버튼도 여기 있다. 들어 있는 것은 등불지기의 오늘의 판 쪽(lantern-keeper/lobby.ts)과 같다.
 * 무엇을 적을지는 daily.ts가 정한다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { store } from '../../core/store';
import { addText, drawPanel, PixelButton } from '../../core/ui';
import { knownDayRank, loadDayBoard } from '../../online/online';
import { isJoined } from '../../online/profile';
import {
  DAILY_RULES,
  DAILY_TEXT,
  dailyBest,
  dailyDiscard,
  dailyHint,
  dailyStreak,
  dailyToday,
  dayLabel,
  friendLine,
  friendNotice,
  RANK_TEXT,
  rankButton,
  SHARED_DAY_PASSED,
  type GardenDaily,
} from './daily';
import { GARDEN_GAME_ID } from './data';
import { FOOT, INFO_HEIGHT, MARGIN, WIDTH } from './shop-row';

export interface DailyPageHooks {
  /** 이 기기가 보는 오늘(daily.ts의 dayIndexOf) */
  today: number;
  /** 이 기기에 남은 오늘의 판 기록 */
  record: GardenDaily;
  /** 공유받은 주소에 실려 온, 오늘 넘어 볼 친구의 점수. 없으면 null */
  friend: number | null;
  /** 공유받은 주소의 날이 이미 지났는지. 그러면 오늘의 판을 열고 그렇다고 알린다. */
  sharedPassed: boolean;
  /** 두고 간 판이 몇째 날에 멈췄는지. 없으면 null. 오늘의 판을 시작하면 그 판은 마친다. */
  savedDay: number | null;
  onBack: () => void;
  onRank: () => void;
  onStart: () => void;
}

/** 카드의 머리글 높이와 한 줄의 높이, 카드 사이, 왼쪽 돌아가기 버튼의 폭 */
const CARD = { head: 24, line: 17, gap: 8, bottom: 6 } as const;
const BACK_WIDTH = 96;
const RANK_BUTTON = { height: 28, inset: 12 } as const;

export function buildDailyPage(scene: Phaser.Scene, hooks: DailyPageHooks): void {
  const { height } = scene.scale;
  const { today } = hooks;
  const record = dailyToday(hooks.record, today);
  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: hooks.onBack,
  });
  addText(scene, 42, 21, DAILY_TEXT.name, { size: 16, originY: 0.5 });
  addText(scene, GAME_WIDTH - MARGIN, 21, dayLabel(today), {
    size: FONT_SIZE.small,
    color: THEME_CSS.sub,
    originX: 1,
    originY: 0.5,
  });

  // 오늘의 조건: 누구나 같은 판이라는 것과, 무엇이 남는지
  let top = 42;
  const rulesHeight = CARD.head + DAILY_RULES.length * CARD.line + CARD.bottom;
  drawPanel(scene.add.graphics(), MARGIN, top, WIDTH, rulesHeight, {
    depth: 2,
    radius: 10,
    border: THEME.mintDeep,
    fill: THEME.mintSoft,
  });
  addText(scene, MARGIN + 10, top + 7, DAILY_TEXT.rules, { color: THEME_CSS.good });
  DAILY_RULES.forEach((line, index) => {
    addText(scene, MARGIN + 14, top + CARD.head + index * CARD.line, `· ${line}`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.ink,
    });
  });
  top += rulesHeight + CARD.gap;

  // 오늘의 기록: 최고 기록, 이어 온 날, (주소로 받았으면) 넘어 볼 친구 기록
  const rows: Array<[string, string, string]> = [
    [DAILY_TEXT.best, dailyBest(record, today), record.tries > 0 ? THEME_CSS.accent : THEME_CSS.sub],
    [DAILY_TEXT.streak, dailyStreak(record, today), THEME_CSS.ink],
  ];
  if (hooks.friend !== null) {
    const best = record.tries > 0 ? record.best : null;
    const beaten = best !== null && best > hooks.friend;
    rows.push([DAILY_TEXT.friend, friendLine(hooks.friend, best), beaten ? THEME_CSS.good : THEME_CSS.accent]);
  }
  const recordHeight = CARD.head + rows.length * CARD.line + CARD.bottom;
  drawPanel(scene.add.graphics(), MARGIN, top, WIDTH, recordHeight, { depth: 2, radius: 10 });
  addText(scene, MARGIN + 10, top + 7, DAILY_TEXT.record, { color: THEME_CSS.accent });
  rows.forEach(([name, value, color], index) => {
    const y = top + CARD.head + index * CARD.line;
    addText(scene, MARGIN + 14, y, name, { size: FONT_SIZE.small, color: THEME_CSS.sub });
    addText(scene, GAME_WIDTH - MARGIN - 10, y, value, { size: FONT_SIZE.small, color, originX: 1 });
  });
  top += recordHeight + CARD.gap;

  // 오늘의 랭킹으로 가는 버튼. 내 순위를 알고 있으면 같이 적는다.
  const rank = new PixelButton(scene, {
    x: MARGIN + RANK_BUTTON.inset,
    y: top,
    width: WIDTH - RANK_BUTTON.inset * 2,
    height: RANK_BUTTON.height,
    label: '',
    style: 'blue',
    onTap: hooks.onRank,
  });
  const showRank = (): void => {
    const known = isJoined(store.data.online) ? knownDayRank(GARDEN_GAME_ID, today) : null;
    rank.setLabel(known === null ? RANK_TEXT.button : rankButton(known));
  };
  showRank();
  // 랭킹에 참여하고 있으면 지금의 내 순위를 물어 와서 버튼에 적는다. 인터넷이 없으면 그대로 둔다.
  if (isJoined(store.data.online)) {
    let alive = true;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      alive = false;
    });
    void loadDayBoard(GARDEN_GAME_ID).then(() => {
      if (alive) showRank();
    });
  }

  // 맨 아래: 설명 칸과, 돌아가기·도전 버튼
  const footTop = height - FOOT.bottom - FOOT.height;
  const infoTop = footTop - INFO_HEIGHT - 4;
  drawPanel(scene.add.graphics(), MARGIN, infoTop, WIDTH, INFO_HEIGHT, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const beaten = hooks.friend !== null && record.tries > 0 && record.best > hooks.friend;
  const first = hooks.sharedPassed
    ? SHARED_DAY_PASSED
    : hooks.friend !== null && !beaten
      ? friendNotice(hooks.friend)
      : dailyHint(record, today);
  const info = addText(scene, GAME_WIDTH / 2, infoTop + INFO_HEIGHT / 2, first, {
    size: FONT_SIZE.small,
    color: THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
    lineSpacing: 1,
  });
  new PixelButton(scene, {
    x: MARGIN,
    y: footTop,
    width: BACK_WIDTH,
    height: FOOT.height,
    label: DAILY_TEXT.back,
    style: 'neutral',
    onTap: hooks.onBack,
  });
  const label = record.tries > 0 ? DAILY_TEXT.again : DAILY_TEXT.go;
  // 두고 간 판이 있으면 그 판을 마치고 시작하므로 한 번 더 누르게 한다.
  let armed = hooks.savedDay === null;
  const goX = MARGIN + BACK_WIDTH + 6;
  const go = new PixelButton(scene, {
    x: goX,
    y: footTop,
    width: GAME_WIDTH - MARGIN - goX,
    height: FOOT.height,
    label,
    style: 'pink',
    onTap: () => {
      if (armed) {
        hooks.onStart();
        return;
      }
      armed = true;
      info.setText(dailyDiscard(hooks.savedDay ?? 1)).setColor(THEME_CSS.bad);
      go.setLabel(DAILY_TEXT.sure).setStyle('red');
    },
  });
}
