/**
 * 싸움 화면. 위에 적들(머리 위에 다음 행동), 가운데에 토끼와 마력, 그 아래 설명 칸, 맨 아래 손패와 "차례 끝".
 *
 * 카드를 누르면 살짝 올라오고 설명 칸에 무엇을 하는지 보인다. 한 번 더 누르면 낸다.
 * 적을 골라야 하는 카드는 적이 하나면 그 적에게, 여럿이면 적을 눌러서 낸다.
 * 고른 카드가 없을 때 적을 누르면 그 적이 다음에 할 행동과 상태를 설명 칸에 보여 준다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx, tone } from '../../core/sfx';
import { addTapZone, addText, drawPanel, PixelButton } from '../../core/ui';
import { showBanner } from '../../scenes/GameHud';
import { CARD_COLOR, cardTypeTexture, enemyTexture, LOOK, statusTexture, TEX } from './art';
import {
  attackDamage,
  canPlay,
  cardBlock,
  cardCost,
  intentOf,
  needsTarget,
  type Battle,
  type BattleEvent,
  type Card,
  type Fighter,
  type Who,
} from './battle';
import { DEPTH, drawTopBar, MARGIN, TOP_BAR, WIDTH } from './bits';
import { CARDS, ENEMIES, STATUS_ORDER, STATUSES, TREASURES, type Act } from './data';
import { runEndTurn, runPlayCard, type RunState } from './run';
import { cardName, cardText, moveText, type CardTextContext } from './text';

/** 손패 카드 한 장의 크기 */
export const HAND_CARD = { width: 44, height: 74, lift: 12 } as const;
/** 적이 한 마리씩 행동하는 사이(ms) */
const FOE_STEP_MS = 560;

export const BATTLE_TEXT = {
  hint: '카드를 눌러 골라요. 한 번 더 누르면 내요',
  pickFoe: '누구에게 낼까요? 적을 눌러요',
  noMana: '마력이 모자라요',
  endTurn: '차례 끝',
  win: '이겼어요!',
  lose: '쓰러졌어요',
} as const;

interface Layout {
  foeTop: number;
  foeGround: number;
  meTop: number;
  infoTop: number;
  handTop: number;
  footTop: number;
}

function layoutFor(height: number): Layout {
  const footTop = height - 36;
  const handTop = footTop - HAND_CARD.height - 6;
  const infoTop = handTop - HAND_CARD.lift - 40;
  const meTop = infoTop - 52;
  return { foeTop: TOP_BAR + 4, foeGround: meTop - 24, meTop, infoTop, handTop, footTop };
}

export interface BattleHooks {
  /** 판이 바뀌었으니 저장한다. */
  save: () => void;
  /** 싸움이 끝났다(이겼거나 졌다). 판의 stage는 이미 다음 화면을 가리킨다. */
  done: (result: 'win' | 'lose') => void;
}

export class BattleView {
  private readonly layout: Layout;
  private layer: Phaser.GameObjects.GameObject[] = [];
  private selected: number | null = null;
  /** 적이 행동하는 동안이라 누를 수 없다. */
  private busy = false;
  private foeSprites: (Phaser.GameObjects.Image | null)[] = [];
  private foeCenters: { x: number; y: number }[] = [];
  private meSprite!: Phaser.GameObjects.Image;
  private info!: Phaser.GameObjects.Text;
  private endButton!: PixelButton;
  private infoMessage: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: RunState,
    private readonly hooks: BattleHooks,
  ) {
    this.layout = layoutFor(scene.scale.height);
    this.buildFixed();
    this.render();
  }

  /** 손패 index번째 카드의 누르는 자리(논리 좌표). 자동 점검이 쓴다. */
  handPoint(index: number): { x: number; y: number } | null {
    const xs = this.handPositions(this.battle.hand.length);
    const x = xs[index];
    if (x === undefined) return null;
    const right = index < xs.length - 1 ? xs[index + 1] : x + HAND_CARD.width;
    return { x: (x + right) / 2, y: this.layout.handTop + HAND_CARD.height / 2 };
  }

  /** 적 index의 누르는 자리. 자동 점검이 쓴다. */
  foePoint(index: number): { x: number; y: number } | null {
    return this.foeCenters[index] ?? null;
  }

  private get battle(): Battle {
    const battle = this.run.battle;
    if (!battle) throw new Error('싸움이 없다');
    return battle;
  }

  // ───────── 그리기 ─────────

  /** 다시 그리지 않는 것: 설명 칸과 "차례 끝" 버튼 */
  private buildFixed(): void {
    const { infoTop, footTop } = this.layout;
    const panel = this.scene.add.graphics();
    drawPanel(panel, MARGIN, infoTop, WIDTH, 34, { fill: THEME.butterSoft, shadow: null, radius: 10 });
    this.info = addText(this.scene, GAME_WIDTH / 2, infoTop + 17, '', {
      size: 10,
      color: THEME_CSS.ink,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      wrapWidth: WIDTH - 14,
      lineSpacing: 0,
    });
    this.endButton = new PixelButton(this.scene, {
      x: GAME_WIDTH - MARGIN - 84,
      y: footTop + 2,
      width: 84,
      height: 30,
      label: BATTLE_TEXT.endTurn,
      style: 'pink',
      hitPadding: 3,
      onTap: () => this.endTurn(),
    });
  }

  /** 싸움을 통째로 다시 그린다. battle을 주면 그 모습(적이 행동하는 중간)으로 그린다. */
  render(battle: Battle = this.battle): void {
    for (const object of this.layer) object.destroy();
    this.layer = [];
    const before = this.scene.children.list.length;
    drawTopBar(this.scene, { ...this.run, hp: battle.me.hp });
    this.drawFoes(battle);
    this.drawMe(battle);
    this.drawHand(battle);
    this.drawFoot(battle);
    this.layer = this.scene.children.list.slice(before);
    this.refreshInfo(battle);
    const canAct = !this.busy && battle.result === null;
    this.endButton.setEnabled(canAct);
    const anyPlayable = battle.hand.some((card) => canPlay(battle, card));
    this.endButton.setStyle(anyPlayable ? 'neutral' : 'pink');
  }

  private drawFoes(battle: Battle): void {
    const { foeTop, foeGround } = this.layout;
    const count = battle.foes.length;
    const slot = WIDTH / count;
    this.foeSprites = [];
    this.foeCenters = [];
    const room = foeGround - foeTop - 26;
    battle.foes.forEach((foe, index) => {
      const def = ENEMIES[foe.id];
      const cx = MARGIN + slot * (index + 0.5);
      // 넓은 화면에서는 조금 크게 그리되, 자리(높이와 한 마리의 폭)를 넘지 않게 한다.
      const scale = Math.min((def.size ?? 1) * 1.7, room / 48, (slot - 4) / 48);
      const size = 48 * scale;
      const cy = foeGround - size / 2;
      this.foeCenters.push({ x: cx, y: cy });
      if (foe.dead) {
        this.foeSprites.push(null);
        return;
      }
      const targeting = this.selected !== null && this.selectedNeedsTarget(battle);
      if (targeting) {
        const ring = this.scene.add.graphics();
        ring.lineStyle(2, THEME.pinkDeep, 0.9);
        ring.strokeEllipse(cx, foeGround - 2, size * 0.9, 10);
      }
      const shadow = this.scene.add.graphics();
      shadow.fillStyle(0x5b4455, 0.12);
      shadow.fillEllipse(cx, foeGround, size * 0.8, 7);
      const sprite = this.scene.add.image(cx, cy, enemyTexture(def.look)).setScale(scale);
      this.foeSprites.push(sprite);
      // 다음 행동
      const intent = intentOf(battle, index);
      this.drawIntent(cx, cy - size / 2 - 9, intent);
      // 체력 막대와 방어
      this.drawHpBar(cx - Math.min(slot - 10, 64) / 2, foeGround + 5, Math.min(slot - 10, 64), foe, LOOK.hpFill);
      this.drawStatuses(foe, cx, foeGround + 19, slot - 6, 'center');
      addTapZone(this.scene, cx - slot / 2 + 2, cy - size / 2 - 18, slot - 4, foeGround - cy + size / 2 + 34, () => undefined, () =>
        this.tapFoe(index),
      );
    });
  }

  private drawIntent(cx: number, y: number, intent: ReturnType<typeof intentOf>): void {
    const parts: { texture: string; label: string }[] = [];
    if (intent.attack) {
      const { n, times } = intent.attack;
      parts.push({ texture: TEX.sword, label: times > 1 ? `${n}x${times}` : String(n) });
    }
    if (intent.defend) parts.push({ texture: TEX.shield, label: '' });
    if (intent.buff) parts.push({ texture: TEX.buff, label: '' });
    if (intent.debuff) parts.push({ texture: TEX.debuff, label: '' });
    const objects: { image: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text | null }[] = parts.map((part) => ({
      image: this.scene.add.image(0, y, part.texture).setDepth(1),
      text: part.label
        ? addText(this.scene, 0, y, part.label, { size: 11, color: THEME_CSS.bad, originY: 0.5, stroke: THEME_CSS.white }).setDepth(1)
        : null,
    }));
    const width = objects.reduce((sum, item) => sum + 14 + (item.text ? item.text.width + 1 : 0), 0) + (objects.length - 1) * 2;
    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 0.85);
    g.fillRoundedRect(cx - width / 2 - 4, y - 9, width + 8, 18, 9);
    let x = cx - width / 2;
    for (const item of objects) {
      item.image.setX(x + 7);
      x += 14;
      if (item.text) {
        item.text.setX(x + 1);
        x += item.text.width + 1;
      }
      x += 2;
    }
  }

  private drawHpBar(x: number, y: number, width: number, fighter: Fighter, color: number): void {
    const g = this.scene.add.graphics();
    const height = 9;
    g.fillStyle(LOOK.hpBack, 0.85);
    g.fillRoundedRect(x, y, width, height, height / 2);
    const ratio = Math.max(0, fighter.hp / fighter.maxHp);
    if (ratio > 0) {
      g.fillStyle(color, 1);
      g.fillRoundedRect(x, y, Math.max(height, width * ratio), height, height / 2);
    }
    if (fighter.block > 0) {
      g.lineStyle(2, LOOK.block, 1);
      g.strokeRoundedRect(x - 1, y - 1, width + 2, height + 2, (height + 2) / 2);
      this.scene.add.image(x - 2, y + height / 2, TEX.shield).setScale(1.05);
      addText(this.scene, x - 2, y + height / 2, String(fighter.block), {
        size: 9,
        color: THEME_CSS.white,
        originX: 0.5,
        originY: 0.5,
      });
    }
    addText(this.scene, x + width / 2, y + height / 2, `${fighter.hp}/${fighter.maxHp}`, {
      size: 9,
      color: THEME_CSS.white,
      originX: 0.5,
      originY: 0.5,
    });
  }

  private drawStatuses(fighter: Fighter, x: number, y: number, width: number, align: 'center' | 'left'): void {
    const ids = STATUS_ORDER.filter((id) => (fighter.st[id] ?? 0) !== 0);
    if (ids.length === 0) return;
    const step = Math.min(24, width / ids.length);
    let left = align === 'center' ? x - (step * ids.length) / 2 : x;
    for (const id of ids) {
      this.scene.add.image(left + 6, y, statusTexture(id));
      addText(this.scene, left + 12, y + 1, String(fighter.st[id]), {
        size: 9,
        color: STATUSES[id].good ? THEME_CSS.good : THEME_CSS.bad,
        originY: 0.5,
        stroke: THEME_CSS.white,
      });
      left += step;
    }
  }

  private drawMe(battle: Battle): void {
    const { meTop } = this.layout;
    const me = battle.me;
    const g = this.scene.add.graphics();
    g.fillStyle(0x5b4455, 0.12);
    g.fillEllipse(MARGIN + 22, meTop + 47, 34, 6);
    this.meSprite = this.scene.add.image(MARGIN + 22, meTop + 24, TEX.bunny).setScale(0.9);
    this.drawHpBar(MARGIN + 52, meTop + 10, 100, me, LOOK.hpMe);
    this.drawStatuses(me, MARGIN + 50, meTop + 32, 110, 'left');
    // 마력
    const manaX = GAME_WIDTH - MARGIN - 26;
    const manaY = meTop + 22;
    this.scene.add.image(manaX, manaY, TEX.mana).setScale(1.5);
    addText(this.scene, manaX, manaY, String(battle.mana), { size: 18, color: THEME_CSS.inkDeep, originX: 0.5, originY: 0.5 });
    addText(this.scene, manaX, manaY + 22, '마력', { size: 9, color: THEME_CSS.sub, originX: 0.5, originY: 0.5 });
    // 보물
    let x = MARGIN + 52;
    const treasures = this.run.treasures;
    const step = Math.min(18, 110 / Math.max(1, treasures.length));
    for (const id of treasures) {
      this.scene.add.image(x + 7, meTop + 46, `ct-tr-${id}`).setScale(0.62);
      x += step;
    }
  }

  private handPositions(count: number): number[] {
    if (count === 0) return [];
    const { width } = HAND_CARD;
    const span = GAME_WIDTH - 12 - width;
    const step = count > 1 ? Math.min(width + 3, span / (count - 1)) : 0;
    const total = step * (count - 1) + width;
    const left = (GAME_WIDTH - total) / 2;
    return Array.from({ length: count }, (_, index) => left + index * step);
  }

  private drawHand(battle: Battle): void {
    const { handTop } = this.layout;
    const xs = this.handPositions(battle.hand.length);
    const ctx = this.textContext(battle, null);
    battle.hand.forEach((card, index) => {
      const lifted = index === this.selected;
      this.drawCard(card, xs[index], handTop - (lifted ? HAND_CARD.lift : 0), canPlay(battle, card) && !this.busy, lifted, ctx);
    });
    // 누르는 자리는 카드가 겹친 만큼 나눠서, 위에 놓인 카드가 아니라 보이는 쪽을 누르게 한다.
    battle.hand.forEach((_, index) => {
      const left = xs[index];
      const right = index < xs.length - 1 ? xs[index + 1] : left + HAND_CARD.width;
      addTapZone(this.scene, left, handTop - HAND_CARD.lift, right - left, HAND_CARD.height + HAND_CARD.lift, () => undefined, () =>
        this.tapCard(index),
      );
    });
  }

  private drawCard(card: Card, x: number, y: number, playable: boolean, lifted: boolean, ctx: CardTextContext): void {
    const def = CARDS[card.id];
    const color = CARD_COLOR[def.type];
    const { width, height } = HAND_CARD;
    const g = this.scene.add.graphics();
    drawPanel(g, x, y, width, height, {
      depth: 3,
      radius: 8,
      fill: playable ? 0xffffff : THEME.dim,
      border: lifted ? THEME.pinkDeep : def.rarity === 'rare' ? THEME.gold : color.deep,
    });
    g.fillStyle(color.face, playable ? 1 : 0.5);
    g.fillRoundedRect(x + 3, y + 3, width - 6, 25, 6);
    const alpha = playable ? 1 : 0.6;
    // 이름이 길면 띄어 쓴 곳에서 두 줄로 나눈다.
    const label = cardName(card.id, card.up);
    const name = addText(this.scene, x + width / 2, y + 16, label, {
      size: 10,
      color: card.up ? THEME_CSS.good : THEME_CSS.inkDeep,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: -3,
    }).setAlpha(alpha);
    if (name.width > width - 6 && label.includes(' ')) name.setText(label.replace(' ', '\n'));
    if (name.width > width - 6) name.setScale((width - 6) / name.width);
    this.scene.add.image(x + width / 2, y + 43, cardTypeTexture(def.type)).setScale(0.85).setAlpha(alpha);
    const badge = cardBadge(def.acts[card.up ? 1 : 0], ctx);
    if (badge) {
      const text = addText(this.scene, x + width / 2, y + height - 12, badge, {
        size: 11,
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      }).setAlpha(alpha);
      if (text.width > width - 6) text.setScale((width - 6) / text.width);
    }
    // 마력 동그라미
    const cost = cardCost(card);
    const bubble = this.scene.add.graphics();
    bubble.fillStyle(THEME.lilacDeep, 1);
    bubble.fillCircle(x + 3, y + 3, 8.5);
    bubble.fillStyle(playable ? THEME.lilac : THEME.shadow, 1);
    bubble.fillCircle(x + 3, y + 2, 7.5);
    addText(this.scene, x + 3, y + 2, String(cost), { size: 11, color: THEME_CSS.inkDeep, originX: 0.5, originY: 0.5 });
  }

  private drawFoot(battle: Battle): void {
    const { footTop } = this.layout;
    const pile = (x: number, texture: string, count: number): void => {
      this.scene.add.image(x, footTop + 16, texture);
      addText(this.scene, x + 10, footTop + 16, String(count), { size: 11, color: THEME_CSS.sub, originY: 0.5 });
    };
    pile(MARGIN + 8, TEX.deck, battle.draw.length);
    pile(MARGIN + 44, TEX.discard, battle.discard.length);
    addText(this.scene, MARGIN + 80, footTop + 16, `${battle.turn}번째 차례`, { size: 9, color: THEME_CSS.faint, originY: 0.5 });
  }

  // ───────── 설명 칸 ─────────

  private setInfo(message: string | null): void {
    this.infoMessage = message;
    this.refreshInfo(this.battle);
  }

  private refreshInfo(battle: Battle): void {
    let text: string = BATTLE_TEXT.hint;
    if (this.infoMessage) text = this.infoMessage;
    else if (this.selected !== null) {
      const card = battle.hand[this.selected];
      if (card) {
        const ctx = this.textContext(battle, battle.foes.findIndex((foe) => !foe.dead && livingCount(battle) === 1));
        text = `${cardName(card.id, card.up)}: ${cardText(card.id, card.up, ctx)}`;
        if (this.selectedNeedsTarget(battle) && livingCount(battle) > 1) text += `\n${BATTLE_TEXT.pickFoe}`;
      }
    }
    this.info.setText(text);
    this.info.setScale(1);
    if (this.info.height > 32) this.info.setScale(32 / this.info.height);
  }

  /** 카드 설명에 쓸 값: 지금의 힘과 움츠림, (적이 하나면) 그 적의 허점을 셈한다. */
  private textContext(battle: Battle, target: number | null): CardTextContext {
    const foe = target !== null && target >= 0 ? battle.foes[target] : null;
    return {
      hit: (n) => attackDamage(n, battle.me, foe),
      block: (n) => cardBlock(n, battle.me),
    };
  }

  private selectedNeedsTarget(battle: Battle): boolean {
    if (this.selected === null) return false;
    const card = battle.hand[this.selected];
    return card ? needsTarget(card.id, card.up) : false;
  }

  // ───────── 누르기 ─────────

  private tapCard(index: number): void {
    if (this.busy) return;
    const battle = this.battle;
    const card = battle.hand[index];
    if (!card) return;
    if (this.selected !== index) {
      sfx.flip();
      this.selected = index;
      this.infoMessage = null;
      this.render();
      return;
    }
    if (!canPlay(battle, card)) {
      sfx.deny();
      this.setInfo(BATTLE_TEXT.noMana);
      return;
    }
    if (needsTarget(card.id, card.up)) {
      const living = battle.foes.flatMap((foe, i) => (foe.dead ? [] : [i]));
      if (living.length === 1) this.play(index, living[0]);
      else this.setInfo(BATTLE_TEXT.pickFoe);
      return;
    }
    this.play(index, null);
  }

  private tapFoe(index: number): void {
    if (this.busy) return;
    const battle = this.battle;
    const foe = battle.foes[index];
    if (!foe || foe.dead) return;
    if (this.selected !== null && this.selectedNeedsTarget(battle)) {
      const card = battle.hand[this.selected];
      if (card && !canPlay(battle, card)) {
        sfx.deny();
        this.setInfo(BATTLE_TEXT.noMana);
        return;
      }
      this.play(this.selected, index);
      return;
    }
    // 고른 카드가 없으면 그 적의 설명을 보여 준다.
    this.selected = null;
    const statuses = STATUS_ORDER.filter((id) => (foe.st[id] ?? 0) !== 0)
      .map((id) => `${STATUSES[id].name} ${foe.st[id]}`)
      .join(', ');
    const move = moveText(foe.id, foe.next, (n) => attackDamage(n, foe, battle.me));
    this.render();
    this.setInfo(`${ENEMIES[foe.id].name} · 다음: ${move}${statuses ? `\n${statuses}` : ''}`);
  }

  private play(handIndex: number, target: number | null): void {
    const battle = this.battle;
    const card = battle.hand[handIndex];
    if (!card) return;
    const xs = this.handPositions(battle.hand.length);
    const from = { x: xs[handIndex] + HAND_CARD.width / 2, y: this.layout.handTop };
    const events = runPlayCard(this.run, handIndex, target);
    if (!events) {
      sfx.deny();
      return;
    }
    this.selected = null;
    this.infoMessage = null;
    this.flyCard(card, from, target);
    this.render();
    this.show(events);
    this.hooks.save();
    this.checkDone();
  }

  /** 낸 카드가 적(또는 위)으로 날아가며 사라진다. */
  private flyCard(card: Card, from: { x: number; y: number }, target: number | null): void {
    const color = CARD_COLOR[CARDS[card.id].type];
    const ghost = this.scene.add.graphics().setDepth(DEPTH.float);
    ghost.fillStyle(color.face, 1);
    ghost.fillRoundedRect(-14, -20, 28, 40, 6);
    ghost.setPosition(from.x, from.y + 20);
    const to = target !== null ? this.foeCenters[target] : { x: GAME_WIDTH / 2, y: this.layout.meTop };
    this.scene.tweens.add({
      targets: ghost,
      x: to.x,
      y: to.y,
      scale: 0.4,
      alpha: 0,
      duration: 220,
      ease: 'Quad.In',
      onComplete: () => ghost.destroy(),
    });
  }

  private endTurn(): void {
    if (this.busy) return;
    const battle = this.battle;
    if (battle.result !== null) return;
    this.busy = true;
    this.selected = null;
    this.infoMessage = null;
    sfx.whoosh();
    const steps = runEndTurn(this.run);
    this.hooks.save();
    this.render(steps[0]?.after ?? battle);
    let delay = 260;
    steps.forEach((step, index) => {
      this.scene.time.delayedCall(delay, () => {
        const last = index === steps.length - 1;
        this.render(step.after);
        this.show(step.events);
        if (last) {
          this.busy = false;
          this.render();
          this.checkDone();
        }
      });
      delay += step.who === -1 ? 200 : FOE_STEP_MS;
    });
    if (steps.length === 0) this.busy = false;
  }

  private checkDone(): void {
    const result = this.battle.result;
    if (result === null) return;
    this.busy = true;
    this.endButton.setEnabled(false);
    const middle = (this.layout.foeTop + this.layout.foeGround) / 2;
    if (result === 'win') {
      sfx.fanfare();
      showBanner(this.scene, middle, BATTLE_TEXT.win, THEME_CSS.good, 1100, DEPTH.overlay, FONT_SIZE.large);
      this.scene.time.delayedCall(1000, () => this.hooks.done('win'));
    } else {
      vibrate([30, 50, 60]);
      this.scene.cameras.main.shake(260, 0.012);
      showBanner(this.scene, middle, BATTLE_TEXT.lose, THEME_CSS.bad, 1500, DEPTH.overlay, FONT_SIZE.large);
      this.scene.time.delayedCall(1400, () => this.hooks.done('lose'));
    }
  }

  // ───────── 일어난 일 보여 주기 ─────────

  private pointOf(who: Who): { x: number; y: number } {
    if (who === 'me') return { x: MARGIN + 22, y: this.layout.meTop + 6 };
    return this.foeCenters[who] ?? { x: GAME_WIDTH / 2, y: this.layout.foeGround - 30 };
  }

  private spriteOf(who: Who): Phaser.GameObjects.Image | null {
    return who === 'me' ? this.meSprite : (this.foeSprites[who] ?? null);
  }

  private float(who: Who, label: string, color: string, order: number): void {
    const at = this.pointOf(who);
    const x = Phaser.Math.Clamp(at.x + ((order % 3) - 1) * 10, 20, GAME_WIDTH - 20);
    const text = addText(this.scene, x, at.y - 6 - (order % 2) * 10, label, {
      size: 13,
      color,
      originX: 0.5,
      originY: 1,
      stroke: THEME_CSS.white,
    }).setDepth(DEPTH.float);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      delay: 260,
      duration: 520,
      ease: 'Quad.Out',
      onComplete: () => text.destroy(),
    });
  }

  private shake(who: Who): void {
    const sprite = this.spriteOf(who);
    if (!sprite) return;
    const x = sprite.x;
    this.scene.tweens.add({
      targets: sprite,
      x: { from: x - 3, to: x },
      duration: 160,
      ease: 'Bounce.Out',
    });
    sprite.setTint(0xffb0b0);
    this.scene.time.delayedCall(140, () => {
      if (sprite.active) sprite.clearTint();
    });
  }

  private show(events: readonly BattleEvent[]): void {
    let order = 0;
    let hurtSound = false;
    for (const event of events) {
      order += 1;
      switch (event.t) {
        case 'hurt':
          if (event.n > 0) {
            this.float(event.who, `-${event.n}`, THEME_CSS.bad, order);
            this.shake(event.who);
            if (!hurtSound) {
              hurtSound = true;
              if (event.who === 'me') {
                sfx.bump();
                vibrate(15);
              } else sfx.hit(Math.min(8, event.n / 3));
            }
          } else if (event.blocked > 0) {
            this.float(event.who, '막음', THEME_CSS.sub, order);
            tone(320, 0.05, { type: 'triangle', volume: 0.2 });
          }
          break;
        case 'poison':
          this.float(event.who, `-${event.n}`, '#5aa14a', order);
          this.shake(event.who);
          break;
        case 'block':
          this.float(event.who, `방어 +${event.n}`, '#4a8fd0', order);
          tone(520, 0.05, { type: 'triangle', volume: 0.18 });
          break;
        case 'heal':
          this.float(event.who, `+${event.n}`, THEME_CSS.good, order);
          break;
        case 'status':
          this.float(event.who, `${STATUSES[event.s].name} ${event.n > 0 ? '+' : ''}${event.n}`, STATUSES[event.s].good ? THEME_CSS.good : '#8a5fc0', order);
          break;
        case 'die': {
          const sprite = this.spriteOf(event.who);
          sfx.pop();
          if (sprite) {
            // 다시 그리면 사라지므로, 그 자리에 그림을 하나 더 두고 흐리게 지운다.
            const ghost = this.scene.add.image(sprite.x, sprite.y, sprite.texture.key).setScale(sprite.scale).setDepth(DEPTH.float);
            this.scene.tweens.add({
              targets: ghost,
              alpha: 0,
              scale: sprite.scale * 1.3,
              duration: 380,
              onComplete: () => ghost.destroy(),
            });
          }
          break;
        }
        case 'act': {
          const sprite = this.spriteOf(event.who);
          if (sprite) {
            const y = sprite.y;
            this.scene.tweens.add({ targets: sprite, y: { from: y + 6, to: y }, duration: 200, ease: 'Back.Out' });
          }
          break;
        }
        case 'mana':
          tone(880, 0.08, { slideTo: 1320, volume: 0.15 });
          break;
        case 'draw':
          sfx.flip();
          break;
        case 'treasure':
          this.float('me', TREASURES[event.id].name, THEME_CSS.accent, order);
          break;
      }
    }
  }
}

function livingCount(battle: Battle): number {
  return battle.foes.filter((foe) => !foe.dead).length;
}

/** 손패 카드의 아래에 적는 짧은 값: 첫 피해나 방어. 없으면 null(그림만 보인다). */
export function cardBadge(acts: readonly Act[], ctx: CardTextContext): string | null {
  for (const act of acts) {
    if (act.k === 'hit') return act.times && act.times > 1 ? `피해 ${ctx.hit(act.n)}x${act.times}` : `피해 ${ctx.hit(act.n)}`;
    if (act.k === 'hitAll') return act.times && act.times > 1 ? `모두 ${ctx.hit(act.n)}x${act.times}` : `모두 ${ctx.hit(act.n)}`;
    if (act.k === 'block') return `방어 ${ctx.block(act.n)}`;
    if (act.k === 'draw') return `카드 ${act.n}`;
    if (act.k === 'mana') return `마력 +${act.n}`;
    if (act.k === 'heal') return `회복 ${act.n}`;
  }
  return null;
}
