/**
 * 준비 화면: 가진 씨앗과 가장 멀리 지킨 날, 영구 강화를 사는 목록, 시작하는 날을 고르는 줄, 출발 버튼.
 * 목록이 화면보다 길면 쪽을 넘긴다. 강화를 누르면 목록 아래에 그 강화의 설명이 보인다.
 * 두고 간 판이 있으면 맨 아래 줄이 "새 판"과 "이어하기"로 바뀐다.
 * 지금 밭에서 PLOW_FROM일째까지 지켰으면 기록 칸에 "새 밭 일구기" 버튼이 생기고, 누르면 잃는 것과 얻는 것을 보여 주는 쪽이 열린다.
 * 대장을 물리친 적이 있으면 기록 칸에 "유물" 버튼이 생기고, 누르면 유물 화면(relic-page.ts)이 열린다.
 * 목록과 설명 칸 사이에는 오늘의 판 줄이 있고, 누르면 오늘의 판 쪽(daily-page.ts)이 열린다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { clampPage, layoutPages, pageSlice } from '../../core/paging';
import { sfx } from '../../core/sfx';
import { addBackdrop, addTapZone, addText, drawPanel, Pager, PAGER_HEIGHT, PixelButton } from '../../core/ui';
import { TEX, upgradeTexture } from './art';
import { DAILY_TEXT, dailyInfo, dailyResumeInfo, type GardenDaily } from './daily';
import { UPGRADE_ORDER, UPGRADES, type UpgradeId } from './data';
import { buildRelicPage, RELIC_LABEL } from './relic-page';
import {
  buyUpgrade,
  canBuy,
  canBuyAnyRelic,
  canPlow,
  costLabel,
  effectLine,
  FIELD_BONUS,
  levelOf,
  needLine,
  neededFor,
  plowField,
  PLOW_FROM,
  relicsOpen,
  startDays,
  upgradeCost,
  type GardenMeta,
} from './rules';
import { BUY, drawBuyButton, FOOT, INFO_HEIGHT, LIST_TOP, MARGIN, PillCounter, ROW, WIDTH } from './shop-row';

export interface LobbyHooks {
  /** 처음 열 때 설명 칸에 적을 알림(새 출발점이 열린 것 같은). 없으면 null */
  notice: string | null;
  /** 두고 간 판(이어 할 수 있는 판). 없으면 null. daily는 그 판이 오늘의 판인지다. */
  saved: { day: number; daily: boolean } | null;
  /** 오늘의 판 줄에 적을 오늘의 기록(today는 daily.ts의 dayIndexOf)과, 그 줄을 눌렀을 때 */
  daily: { record: GardenDaily; today: number; onOpen: () => void };
  getMeta: () => GardenMeta;
  setMeta: (meta: GardenMeta) => void;
  /**
   * 다른 곳(설치한 앱과 브라우저 탭)이 그사이 저장한 것이 있는지 저장을 다시 읽는다.
   * 이 준비 화면을 연 뒤로 더 새것을 읽어 왔으면 true를 돌려주고, 그때는 준비 화면이 새 값으로 다시 열린다.
   */
  refresh: () => Promise<boolean>;
  onStart: () => void;
  /** 두고 간 판을 이어 한다. */
  onResume: () => void;
  /** 두고 간 판을 마치고 새 판을 고를 수 있게 한다. */
  onAbandon: () => void;
  onBack: () => void;
}

/** 맨 아래의 시작 줄에서 시작하는 날을 고르는 칸의 폭. 그 오른쪽이 출발 버튼이다. */
const STEPPER_WIDTH = 116;
/** 기록 칸의 오른쪽에 놓이는 버튼들: 새 밭 일구기와 유물 */
const RECORD_BUTTON = { top: 44, height: 24, gap: 4, plow: 88, relic: 42 } as const;
/** 기록 칸에서 왼쪽의 기록과 오른쪽의 판 수 사이에 남기는 틈 */
const RECORD_NOTE_GAP = 6;
/** 목록과 설명 칸 사이의 오늘의 판 줄: 높이와, 설명 칸과의 틈 */
const DAILY_BAR = { height: 26, gap: 4 } as const;

/** 처음 하는 사람에게 기록 대신 보여 주는 두 줄 */
export const INTRO_LINES = '벌레 떼가 울타리를 넘지 못하게 물총으로 지켜요.\n판이 끝나도 씨앗과 강화는 그대로 남아요.';
/** 아직 아무 강화도 고르지 않았을 때 설명 칸에 적는 말 */
export const INFO_HINT = '강화를 누르면 설명이 보여요';
/** 값 버튼에 줄여 적은 값("1065만")의 강화를 골랐을 때, 설명 아래에 온전한 값을 적는다. */
export const exactCost = (cost: number): string => `값은 씨앗 ${cost.toLocaleString('en-US')}개예요`;
export const START_LABEL = '출발!';
/** 시작하는 날을 바꿨을 때 설명 칸에 적는 말 */
export const START_DAY_INFO = '고른 날부터 시작해요.\n대장을 물리치면 그다음 날이 열려요.';
/** 두고 간 판이 있을 때 맨 아래 줄의 두 버튼 */
export const ABANDON_LABEL = '새 판';
export const resumeLabel = (day: number): string => `이어하기 · ${day}일째`;
/** 두고 간 판이 있을 때 설명 칸에 적는 말 */
export function resumeInfo(day: number): string {
  return `${day}일째에서 멈춘 판이 있어요.\n새로 산 강화는 새 판부터 들어가요.`;
}
/** "새 판"을 처음 눌렀을 때 설명 칸에 적는 말. 한 번 더 눌러야 멈춘 판을 마친다. */
export const ABANDON_CONFIRM = '멈춘 판을 여기서 마치고 새 판을 해요.\n한 번 더 누르면 그렇게 해요.';

/** 기록 칸의 오른쪽에 생기는 버튼과, 그것이 여는 쪽의 머리글 */
export const PLOW_LABEL = '새 밭 일구기';
export const PLOW_GO = '일구기';
export const PLOW_SURE = '정말 일구기';
export const PLOW_CANCEL = '그만두기';
/** 새 밭 쪽을 열었을 때 설명 칸에 적는 말 */
export const PLOW_INFO = '1일째부터 다시 시작해요.\n씨앗이 더 들어와서 금방 다시 올라가요.';
/** "일구기"를 처음 눌렀을 때 설명 칸에 적는 말. 한 번 더 눌러야 일군다. */
export const PLOW_CONFIRM = '되돌릴 수 없어요.\n한 번 더 누르면 새 밭으로 가요.';

/** 일군 밭 n개가 주는 덤을 "+30%"처럼 적는다. */
export const fieldPercent = (fields: number, ratio: number): string => `+${Math.round(fields * ratio * 100)}%`;

/** 몇째 밭인지("2번째 밭"). fields는 일군 새 밭의 수다. */
export const fieldName = (fields: number): string => `${fields + 1}번째 밭`;

/** 새 밭을 일구고 준비 화면을 다시 열었을 때 설명 칸에 적는 말 */
export function plowedNotice(fields: number): string {
  return `${fieldName(fields)}을 일궜어요!\n물총 피해와 씨앗이 ${fieldPercent(fields, FIELD_BONUS.damage)}예요.`;
}

/** 새 밭을 일구고 준비 화면을 다시 열 때 한 번 보여 줄 알림 */
let plowedFields: number | null = null;

interface RowView {
  id: UpgradeId;
  panel: Phaser.GameObjects.Graphics;
  level: Phaser.GameObjects.Text;
  effect: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Graphics;
  /** 값 단추의 씨앗 그림 */
  icon: Phaser.GameObjects.Image;
  cost: Phaser.GameObjects.Text;
  nameRight: number;
  top: number;
  pressed: boolean;
  objects: Phaser.GameObjects.GameObject[];
}

export function buildLobby(scene: Phaser.Scene, hooks: LobbyHooks): void {
  const { height } = scene.scale;
  let meta = hooks.getMeta();
  let page = 0;
  let picked: UpgradeId | null = null;
  let rows: RowView[] = [];
  /** "새 판"을 한 번 눌러서, 한 번 더 누르면 멈춘 판을 마치는 때인지 */
  let abandonArmed = false;

  /** 이 준비 화면이 닫혔는지(판을 시작했거나, 나갔거나, 다시 열렸다) */
  let closed = false;
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
  });
  let waiting: Promise<void> = Promise.resolve();
  /**
   * 씨앗과 강화, 기록을 바꾸는 일은 저장을 다시 읽고 나서 한다. 준비 화면을 띄워 둔 사이에 다른 곳이 저장한 것이 있으면
   * 그 일은 하지 않는다: 읽어 둔 옛 값에서 셈해 통째로 쓰면 그사이의 씨앗과 강화, 최고 기록을 덮어쓰기 때문이다.
   * 그때는 준비 화면이 새 값으로 다시 열리므로, 보고 다시 누르면 된다. 연달아 누른 것은 누른 차례대로 한다.
   */
  const withFresh = (action: () => void): void => {
    waiting = waiting.then(async () => {
      if (closed) return;
      const changed = await hooks.refresh().catch(() => false);
      if (changed || closed) return;
      meta = hooks.getMeta();
      action();
    });
  };

  addBackdrop(scene);
  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: hooks.onBack,
  });
  addText(scene, 42, 21, '텃밭 지키기', { size: 16, originY: 0.5 });
  const seeds = new PillCounter(scene, GAME_WIDTH - MARGIN, 10, TEX.seed, meta.seeds);

  // 기록 칸: 해 본 사람에게는 가장 멀리 지킨 날을, 처음 하는 사람에게는 무엇을 하는 게임인지를 보여 준다.
  drawPanel(scene.add.graphics(), MARGIN, 40, WIDTH, 30, { depth: 2, radius: 10 });
  // 새 밭을 일굴 수 있으면 오른쪽에 그 버튼을 둔다. 두고 간 판이 있으면 그 판을 마친 뒤에 일굴 수 있다.
  const plowable = canPlow(meta) && !hooks.saved;
  // 대장을 물리친 적이 있으면 유물로 가는 버튼도 둔다.
  const relics = relicsOpen(meta);
  if (meta.runs > 0 || meta.fields > 0) {
    const best = addText(scene, MARGIN + 10, 55, meta.best > 0 ? `최고 ${meta.best}일째` : '아직 하루도 못 지켰어요', {
      color: THEME_CSS.accent,
      originY: 0.5,
    });
    // 오른쪽 끝에서부터 버튼을 놓고, 남은 자리에 판 수를 적는다.
    let right = GAME_WIDTH - MARGIN - 6;
    if (plowable) {
      right -= RECORD_BUTTON.plow;
      new PixelButton(scene, {
        x: right,
        y: RECORD_BUTTON.top,
        width: RECORD_BUTTON.plow,
        height: RECORD_BUTTON.height,
        label: PLOW_LABEL,
        style: 'green',
        onTap: () => openPlow(),
      });
      right -= RECORD_BUTTON.gap;
    }
    if (relics) {
      right -= RECORD_BUTTON.relic;
      new PixelButton(scene, {
        x: right,
        y: RECORD_BUTTON.top,
        width: RECORD_BUTTON.relic,
        height: RECORD_BUTTON.height,
        label: RELIC_LABEL,
        style: 'blue',
        onTap: () => openRelics(),
      });
      // 지금 올릴 수 있는 유물이 있으면 버튼의 귀퉁이에 점을 찍어 알린다.
      if (canBuyAnyRelic(meta)) {
        const dot = scene.add.graphics();
        dot.fillStyle(THEME.card, 1);
        dot.fillCircle(right + RECORD_BUTTON.relic - 2, RECORD_BUTTON.top + 2, 5);
        dot.fillStyle(THEME.coral, 1);
        dot.fillCircle(right + RECORD_BUTTON.relic - 2, RECORD_BUTTON.top + 2, 3.5);
      }
      right -= RECORD_BUTTON.gap;
    }
    if (!plowable) {
      // 새 밭을 일궜으면 벌레 수 대신 몇째 밭인지 적는다. 유물 버튼이 자리를 차지해서 다 들어가지 않으면 줄여 적는다.
      const runs = `${meta.runs}판`;
      const field = fieldName(meta.fields);
      const labels = meta.fields > 0 ? [`${field} · ${runs}`, field] : [`${runs} · 벌레 ${meta.kills}마리`, runs];
      const note = addText(scene, right - (relics ? 2 : 4), 55, '', {
        size: 10,
        color: THEME_CSS.sub,
        originX: 1,
        originY: 0.5,
      });
      // 왼쪽의 기록과 RECORD_NOTE_GAP만큼은 떨어지는 가장 긴 것을 적는다.
      const room = note.x - (best.x + best.width) - RECORD_NOTE_GAP;
      if (!labels.some((label) => note.setText(label).width <= room)) note.destroy();
    }
  } else {
    addText(scene, GAME_WIDTH / 2, 55, INTRO_LINES, {
      size: 10,
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: 1,
    });
  }

  // 아래에서부터 자리를 잡는다: 시작 줄, 설명 칸, 오늘의 판 줄, (쪽이 나뉘면) 쪽 넘김 줄, 그 위가 목록이다.
  const footTop = height - FOOT.bottom - FOOT.height;
  const infoTop = footTop - INFO_HEIGHT - 4;
  const dailyTop = infoTop - DAILY_BAR.gap - DAILY_BAR.height;
  addDailyBar(scene, dailyTop, hooks.daily);
  const layout = layoutPages(UPGRADE_ORDER.length, dailyTop - 4 - LIST_TOP, ROW.height + ROW.gap, PAGER_HEIGHT);
  const pager = new Pager(scene, GAME_WIDTH / 2, dailyTop - 4 - PAGER_HEIGHT, (next) => {
    page = clampPage(next, layout.pages);
    drawList();
  });

  const infoPanel = scene.add.graphics();
  drawPanel(infoPanel, MARGIN, infoTop, WIDTH, INFO_HEIGHT, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  // 아무 강화도 고르지 않았을 때 설명 칸에 적는 말
  const idle = hooks.saved ? (hooks.saved.daily ? dailyResumeInfo : resumeInfo)(hooks.saved.day) : INFO_HINT;
  const plowed = plowedFields !== null ? plowedNotice(plowedFields) : null;
  plowedFields = null;
  const info = addText(scene, GAME_WIDTH / 2, infoTop + (INFO_HEIGHT) / 2, plowed ?? hooks.notice ?? idle, {
    size: 10,
    color: THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
    lineSpacing: 1,
  });
  /** 고른 강화의 설명. 값을 줄여 적은 강화는 온전한 값을 한 줄 더 적는다. */
  const infoFor = (id: UpgradeId): string => {
    const cost = upgradeCost(id, levelOf(meta.levels, id));
    const short = cost !== null && costLabel(cost) !== String(cost);
    return short ? `${UPGRADES[id].blurb}\n${exactCost(cost)}` : UPGRADES[id].blurb;
  };
  const showInfo = (id: UpgradeId | null): void => {
    // 다른 것을 눌렀으면 "새 판"은 처음부터 다시 묻는다.
    abandonArmed = false;
    picked = id;
    info.setText(id ? infoFor(id) : idle);
    for (const row of rows) drawRow(row);
  };

  const drawRow = (row: RowView): void => {
    const level = levelOf(meta.levels, row.id);
    const def = UPGRADES[row.id];
    const cost = upgradeCost(row.id, level);
    const affordable = canBuy(meta, row.id);
    // 먼저 있어야 하는 강화가 없으면(해바라기 없는 거름) 효과 대신 그것을 적고 팔지 않는다.
    const needs = neededFor(meta.levels, row.id);
    row.panel.clear();
    drawPanel(row.panel, MARGIN, row.top, WIDTH, ROW.height, {
      depth: 2,
      radius: 10,
      border: picked === row.id ? THEME.pinkDeep : undefined,
    });
    row.level.setText(level >= def.maxLevel ? '끝' : `${level}단계`).setX(row.nameRight + 5);
    row.effect.setText(needs ? needLine(needs) : effectLine(row.id, level, meta.fields));

    drawBuyButton(row, row.top, cost === null ? null : costLabel(cost), affordable, row.pressed);
  };

  const buy = (id: UpgradeId): void =>
    withFresh(() => {
      const next = buyUpgrade(meta, id);
      showInfo(id);
      if (next === meta) {
        sfx.deny();
        return;
      }
      meta = next;
      hooks.setMeta(next);
      sfx.coin();
      seeds.set(meta.seeds);
      // 다음 단계의 값으로 바뀐 설명을 다시 적는다.
      info.setText(infoFor(id));
      for (const row of rows) drawRow(row);
    });

  /** 준비 화면에 놓인 것을 바탕만 남기고 모두 감춘다. 그 위에 다른 쪽(새 밭, 유물)을 그린다. */
  const hideLobby = (): void => {
    for (const object of [...scene.children.list]) {
      if (object instanceof Phaser.GameObjects.TileSprite) continue;
      (object as unknown as Phaser.GameObjects.Components.Visible).setVisible?.(false);
      if (object.input) object.disableInteractive();
    }
  };

  /** 유물 화면: 준비 화면을 감추고 유물을 강화하는 목록을 연다. 돌아가면 준비 화면을 처음부터 다시 연다. */
  function openRelics(): void {
    hideLobby();
    buildRelicPage(scene, meta, {
      change: (apply) =>
        withFresh(() => {
          const next = apply(meta);
          if (next === meta) return;
          meta = next;
          hooks.setMeta(next);
        }),
      onClose: () => scene.scene.restart({}),
    });
  }

  /**
   * 새 밭 쪽: 준비 화면을 감추고, 두고 가는 것과 얻는 것과 남는 것을 적은 뒤 두 번 물어서 일군다.
   * 그만두면 준비 화면을 처음부터 다시 연다.
   */
  function openPlow(): void {
    hideLobby();
    buildPlowPage(scene, meta, {
      onCancel: () => scene.scene.restart({}),
      onPlow: () =>
        withFresh(() => {
          const next = plowField(meta);
          if (next === meta) return;
          hooks.setMeta(next);
          plowedFields = next.fields;
          sfx.fanfare();
          scene.scene.restart({});
        }),
    });
  }

  const drawList = (): void => {
    for (const row of rows) for (const object of row.objects) object.destroy();
    rows = [];
    pager.set(layout.pages, page);
    pageSlice(UPGRADE_ORDER, page, layout.perPage).forEach((id, index) => {
      const top = LIST_TOP + index * (ROW.height + ROW.gap);
      const panel = scene.add.graphics();
      const icon = scene.add.image(MARGIN + 19, top + ROW.height / 2, upgradeTexture(id));
      const name = addText(scene, MARGIN + 36, top + 5, UPGRADES[id].name);
      const level = addText(scene, 0, top + 7, '', { size: 10, color: THEME_CSS.sub });
      const effect = addText(scene, MARGIN + 36, top + 21, '', { size: 10, color: THEME_CSS.sub });
      const button = scene.add.graphics();
      const seed = scene.add.image(0, 0, TEX.seed);
      const cost = addText(scene, 0, 0, '', { originY: 0.5 });
      const row: RowView = {
        id,
        panel,
        level,
        effect,
        button,
        icon: seed,
        cost,
        nameRight: name.x + name.width,
        top,
        pressed: false,
        objects: [panel, icon, name, level, effect, button, seed, cost],
      };
      // 줄의 왼쪽을 누르면 설명만 보이고, 오른쪽의 값 버튼을 누르면 산다.
      const pickZone = addTapZone(
        scene,
        MARGIN,
        top,
        WIDTH - BUY.width - 10,
        ROW.height,
        () => {},
        () => {
          sfx.click();
          showInfo(id);
        },
      );
      const buyZone = addTapZone(
        scene,
        MARGIN + WIDTH - BUY.width - 10,
        top,
        BUY.width + 10,
        ROW.height,
        (pressed) => {
          row.pressed = pressed;
          drawRow(row);
        },
        () => buy(id),
      );
      row.objects.push(pickZone, buyZone);
      rows.push(row);
      drawRow(row);
    });
  };
  drawList();

  // 두고 간 판이 있으면: 왼쪽은 그 판을 마치고 새 판을 고르는 버튼, 오른쪽은 이어 하는 버튼이다.
  if (hooks.saved) {
    new PixelButton(scene, {
      x: MARGIN,
      y: footTop,
      width: STEPPER_WIDTH,
      height: FOOT.height,
      label: ABANDON_LABEL,
      style: 'neutral',
      onTap: () => {
        // 멈춘 판은 되돌릴 수 없으니 한 번 더 묻는다.
        if (abandonArmed) {
          withFresh(hooks.onAbandon);
          return;
        }
        showInfo(null);
        abandonArmed = true;
        info.setText(ABANDON_CONFIRM);
      },
    });
    const resumeX = MARGIN + STEPPER_WIDTH + 6;
    new PixelButton(scene, {
      x: resumeX,
      y: footTop,
      width: GAME_WIDTH - MARGIN - resumeX,
      height: FOOT.height,
      label: resumeLabel(hooks.saved.day),
      style: 'pink',
      onTap: hooks.onResume,
    });
    return;
  }

  // 시작 줄: 대장을 물리쳐서 뒤쪽 날이 열렸으면 시작하는 날을 고르는 칸이 왼쪽에 생긴다.
  const days = startDays(meta.best);
  const hasStepper = days.length > 1;
  const startX = hasStepper ? MARGIN + STEPPER_WIDTH + 6 : MARGIN;
  new PixelButton(scene, {
    x: startX,
    y: footTop,
    width: GAME_WIDTH - MARGIN - startX,
    height: FOOT.height,
    label: START_LABEL,
    style: 'pink',
    onTap: hooks.onStart,
  });
  if (!hasStepper) return;

  drawPanel(scene.add.graphics(), MARGIN, footTop, STEPPER_WIDTH, FOOT.height - 3, { depth: 3, radius: 12 });
  const dayLabel = addText(scene, MARGIN + STEPPER_WIDTH / 2, footTop + (FOOT.height - 3) / 2, '', {
    originX: 0.5,
    originY: 0.5,
  });
  const arrow = { width: 26, height: 24 } as const;
  const arrowY = footTop + (FOOT.height - 3 - arrow.height) / 2;
  const step = (by: number): void =>
    withFresh(() => {
      const at = days.indexOf(meta.startDay);
      const next = days[Math.min(days.length - 1, Math.max(0, at + by))];
      if (next === meta.startDay) return;
      meta = { ...meta, startDay: next };
      hooks.setMeta(meta);
      drawStepper();
      showInfo(null);
      info.setText(START_DAY_INFO);
    });
  const prev = new PixelButton(scene, {
    x: MARGIN + 4,
    y: arrowY,
    ...arrow,
    icon: 'icon-prev',
    hitPadding: 5,
    onTap: () => step(-1),
  });
  const next = new PixelButton(scene, {
    x: MARGIN + STEPPER_WIDTH - arrow.width - 4,
    y: arrowY,
    ...arrow,
    icon: 'icon-play',
    hitPadding: 5,
    onTap: () => step(1),
  });
  const drawStepper = (): void => {
    const at = days.indexOf(meta.startDay);
    dayLabel.setText(`${meta.startDay}일째`);
    prev.setEnabled(at > 0);
    next.setEnabled(at < days.length - 1);
  };
  drawStepper();
}

/**
 * 오늘의 판 줄: 왼쪽에 "오늘의 판", 오른쪽에 오늘의 최고 기록(아직 안 했으면 무엇을 하는 판인지)을 적는다.
 * 줄 어디를 눌러도 오늘의 판 쪽이 열린다.
 */
function addDailyBar(scene: Phaser.Scene, top: number, daily: LobbyHooks['daily']): void {
  const { height } = DAILY_BAR;
  const panel = scene.add.graphics();
  const middle = top + (height - 3) / 2;
  const name = addText(scene, MARGIN + 10, middle, DAILY_TEXT.name, { color: THEME_CSS.good, originY: 0.5 });
  const note = addText(scene, GAME_WIDTH - MARGIN - 10, middle, dailyInfo(daily.record, daily.today), {
    size: 10,
    color: THEME_CSS.sub,
    originX: 1,
    originY: 0.5,
  });
  // 누르면 줄이 조금 들어가고 글도 같이 내려간다.
  const draw = (pressed: boolean): void => {
    panel.clear();
    drawPanel(panel, MARGIN, top + (pressed ? 2 : 0), WIDTH, height - 3, {
      depth: pressed ? 1 : 3,
      radius: 10,
      border: THEME.mintDeep,
      fill: THEME.mintSoft,
    });
    name.setY(middle + (pressed ? 2 : 0));
    note.setY(middle + (pressed ? 2 : 0));
  };
  draw(false);
  addTapZone(scene, MARGIN, top, WIDTH, height, draw, () => {
    sfx.click();
    daily.onOpen();
  });
}

/** 새 밭 쪽에 적는 한 묶음: 머리글과 줄들 */
interface PlowBlock {
  title: string;
  lines: string[];
  border: number;
  fill: number;
  color: string;
}

/** 새 밭 쪽에 적을 것들. 화면 없이 테스트할 수 있게 따로 둔다. */
export function plowBlocks(meta: GardenMeta): PlowBlock[] {
  const bought = UPGRADE_ORDER.filter((id) => levelOf(meta.levels, id) > 0).length;
  const now = meta.fields;
  const next = meta.fields + 1;
  return [
    {
      title: '두고 가는 것',
      lines: [`씨앗 ${meta.seeds}개`, bought > 0 ? `강화 ${bought}가지 (모두 0단계로)` : '강화 없음', `최고 ${meta.best}일째와 열린 출발점`],
      border: THEME.coralDeep,
      fill: THEME.pinkSoft,
      color: THEME_CSS.bad,
    },
    {
      title: '새 밭에서 얻는 것',
      lines: [
        `물총 피해 ${fieldPercent(now, FIELD_BONUS.damage)} → ${fieldPercent(next, FIELD_BONUS.damage)}`,
        `받는 씨앗 ${fieldPercent(now, FIELD_BONUS.seeds)} → ${fieldPercent(next, FIELD_BONUS.seeds)}`,
        '늘어난 것은 줄지 않아요',
      ],
      border: THEME.mintDeep,
      fill: THEME.mintSoft,
      color: THEME_CSS.good,
    },
    {
      title: '그대로 남는 것',
      lines: [`유물, 판 수, 모든 밭의 최고 ${Math.max(meta.bestEver, meta.best)}일째`],
      border: THEME.shadow,
      fill: THEME.card,
      color: THEME_CSS.sub,
    },
  ];
}

function buildPlowPage(scene: Phaser.Scene, meta: GardenMeta, actions: { onCancel: () => void; onPlow: () => void }): void {
  const { height } = scene.scale;
  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: actions.onCancel,
  });
  addText(scene, 42, 21, PLOW_LABEL, { size: 16, originY: 0.5 });
  addText(scene, GAME_WIDTH - MARGIN, 21, `${PLOW_FROM}일째를 지켜서 열렸어요`, {
    size: 10,
    color: THEME_CSS.sub,
    originX: 1,
    originY: 0.5,
  });

  const LINE = 17;
  let top = 42;
  for (const block of plowBlocks(meta)) {
    const blockHeight = 26 + block.lines.length * LINE;
    drawPanel(scene.add.graphics(), MARGIN, top, WIDTH, blockHeight, {
      depth: 2,
      radius: 10,
      border: block.border,
      fill: block.fill,
    });
    addText(scene, MARGIN + 10, top + 8, block.title, { color: block.color });
    block.lines.forEach((line, index) => {
      addText(scene, MARGIN + 14, top + 26 + index * LINE, `· ${line}`, { size: 10, color: THEME_CSS.ink });
    });
    top += blockHeight + 8;
  }

  // 맨 아래: 설명 칸과, 그만두기·일구기 버튼. 일구기는 한 번 더 눌러야 일군다.
  const footTop = height - FOOT.bottom - FOOT.height;
  const infoTop = footTop - INFO_HEIGHT - 4;
  drawPanel(scene.add.graphics(), MARGIN, infoTop, WIDTH, INFO_HEIGHT, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, infoTop + (INFO_HEIGHT) / 2, PLOW_INFO, {
    size: 10,
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
    width: STEPPER_WIDTH,
    height: FOOT.height,
    label: PLOW_CANCEL,
    style: 'neutral',
    onTap: actions.onCancel,
  });
  let armed = false;
  const goX = MARGIN + STEPPER_WIDTH + 6;
  const go = new PixelButton(scene, {
    x: goX,
    y: footTop,
    width: GAME_WIDTH - MARGIN - goX,
    height: FOOT.height,
    label: PLOW_GO,
    style: 'green',
    onTap: () => {
      if (armed) {
        actions.onPlow();
        return;
      }
      armed = true;
      info.setText(PLOW_CONFIRM).setColor(THEME_CSS.bad);
      go.setLabel(PLOW_SURE).setStyle('red');
    },
  });
}
