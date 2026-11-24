import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { addPanel, addScrim, addText, Pager, PAGER_HEIGHT, PixelButton } from '../core/ui';
import { getGame } from '../games/registry';
import { markRuleBookSeen, parseToken, ruleBookFor, type Mark, type ParsedToken, type RulePage, type StoneColor, type Suit } from '../games/rule-book';

/** 규칙 안내서를 열 때 넘기는 것 */
export interface RuleBookData {
  gameId: string;
  /** 안내서를 연 씬. 멈춰 두었다가 닫을 때 다시 움직인다. */
  sceneKey: string;
  /** 처음에 보여 줄 쪽(0부터) */
  page?: number;
  /** 닫는 버튼의 이름. 일시정지 화면에서 열었으면 "돌아가기"다. */
  closeLabel?: string;
}

/** 안내서 카드. top은 카드 위에서 쪽 제목까지, body는 내용이 시작하는 곳, foot은 아래 여백이다. */
const BOOK = { width: GAME_WIDTH - 16, pad: 14, heading: 44, body: 68, dot: 10, gap: 6, foot: 10, minHeight: 330 } as const;
const BUTTON = { width: GAME_WIDTH - 16 - 64, height: 30 } as const;
/** 그림 카드의 크기와 간격. 들어 올린 카드(lift)가 위로 올라갈 자리를 줄마다 남긴다. */
const CARD = { w: 24, h: 34, gap: 4, lift: 3, radius: 4 } as const;
const ROW = { note: 14, gap: 8 } as const;

const INK = { red: 0xd6455a, black: 0x3a2d3a, back: 0x9684e0, backSoft: 0xc9bcf8, line: 0x5b4455 } as const;
const INK_CSS = { red: '#d6455a', black: '#3a2d3a' } as const;
const RED_SUITS: readonly Suit[] = ['H', 'D'];

/**
 * 카드 게임의 규칙 안내서(games/rule-book.ts)를 한 쪽씩 보여 주는 화면. 게임 위에 겹쳐 뜨고, 뒤의 씬은 멈춰 둔다.
 * 쪽을 넘길 때는 이 씬을 그 쪽으로 다시 연다(일시정지 화면과 같은 방식).
 */
export class RuleBookScene extends Phaser.Scene implements BackAware {
  private opened: RuleBookData = { gameId: '', sceneKey: '' };

  constructor() {
    super(SCENE.ruleBook);
  }

  onBackRequest(): void {
    this.close();
  }

  /** 안내서를 닫고 연 씬을 다시 움직인다. */
  private close(): void {
    this.scene.stop();
    this.scene.resume(this.opened.sceneKey);
  }

  private turnTo(page: number): void {
    this.scene.restart({ ...this.opened, page } satisfies RuleBookData);
  }

  create(data: RuleBookData): void {
    this.input.enabled = true;
    this.opened = data;
    const pages = ruleBookFor(data.gameId);
    addScrim(this);
    if (!pages) {
      this.close();
      return;
    }
    markRuleBookSeen(data.gameId);
    const index = Math.min(pages.length - 1, Math.max(0, Math.floor(data.page ?? 0)));
    this.drawPage(pages, index);
  }

  private drawPage(pages: readonly RulePage[], index: number): void {
    const { height } = this.scale;
    const page = pages[index];
    const left = Math.round((GAME_WIDTH - BOOK.width) / 2);
    const inner = BOOK.width - BOOK.pad * 2;
    const below = BOOK.gap + PAGER_HEIGHT + BOOK.gap + BUTTON.height + BOOK.foot;
    const room = height - 8 - BOOK.body - below;

    // 카드 줄과 글을 먼저 놓아 보고, 짧은 화면에서 넘치면 작은 글씨로 다시 놓는다.
    let layout = this.layOut(page, inner, FONT_SIZE.normal);
    if (layout.height > room) {
      layout.destroy();
      layout = this.layOut(page, inner, FONT_SIZE.small);
    }

    const panelHeight = Math.min(height - 4, Math.max(BOOK.minHeight, BOOK.body + layout.height + below));
    const top = Math.max(2, Math.round((height - panelHeight) / 2));
    addPanel(this, left, top, BOOK.width, panelHeight, { radius: 18, depth: 4 });

    const title = getGame(this.opened.gameId)?.title ?? '';
    addText(this, GAME_WIDTH / 2, top + 12, `${title} 규칙`, { size: 18, originX: 0.5 });
    addText(this, GAME_WIDTH / 2, top + BOOK.heading, `${index + 1}. ${page.title}`, {
      size: 14,
      color: THEME_CSS.accent,
      originX: 0.5,
    });
    layout.place(left + BOOK.pad, top + BOOK.body);

    const pagerTop = top + panelHeight - BOOK.foot - BUTTON.height - BOOK.gap - PAGER_HEIGHT;
    const pager = new Pager(this, GAME_WIDTH / 2, pagerTop, (next) => this.turnTo(next));
    pager.set(pages.length, index);

    const last = index === pages.length - 1;
    new PixelButton(this, {
      x: Math.round((GAME_WIDTH - BUTTON.width) / 2),
      y: pagerTop + PAGER_HEIGHT + BOOK.gap,
      width: BUTTON.width,
      height: BUTTON.height,
      // 마지막 쪽이 아니면 다음 쪽으로 넘기는 것이 가장 흔한 일이라, 큰 버튼이 다음 쪽으로 간다.
      label: last ? (this.opened.closeLabel ?? '다 봤어요') : '다음',
      style: last ? 'pink' : 'green',
      onTap: () => (last ? this.close() : this.turnTo(index + 1)),
    });
    // 끝까지 넘기지 않고도 닫을 수 있게 위쪽 구석에 닫기를 둔다.
    if (!last) {
      new PixelButton(this, {
        x: left + BOOK.width - 8 - 34,
        y: top + 8,
        width: 34,
        height: 24,
        label: '닫기',
        hitPadding: 4,
        onTap: () => this.close(),
      });
    }
  }

  /**
   * 한 쪽의 카드 줄과 글을 만들어 두고, 차지하는 높이와 자리를 잡는 함수를 돌려준다.
   * 자리를 잡기 전에는 화면 밖(0, 0)에 있으므로 높이만 재고 버려도 된다.
   */
  private layOut(
    page: RulePage,
    width: number,
    size: number,
  ): { height: number; place: (x: number, y: number) => void; destroy: () => void } {
    const objects: Phaser.GameObjects.GameObject[] = [];
    const placers: Array<(x: number, y: number) => void> = [];
    let height = 0;

    for (const row of page.rows ?? []) {
      const rowTop = height;
      const tokens = row.cards.map(parseToken);
      const drawn = this.drawRow(tokens);
      objects.push(drawn.container);
      placers.push((x, y) => drawn.container.setPosition(Math.round(x + (width - drawn.width) / 2), y + rowTop + CARD.lift));
      height += CARD.lift + CARD.h;
      if (row.note) {
        const note = addText(this, 0, 0, row.note, {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          originX: 0.5,
          align: 'center',
          wrapWidth: width,
        }).setDepth(5);
        const noteTop = height + 3;
        objects.push(note);
        placers.push((x, y) => note.setPosition(Math.round(x + width / 2), y + noteTop));
        height = noteTop + Math.ceil(note.height);
      }
      height += ROW.gap;
    }
    if ((page.rows?.length ?? 0) > 0) height += 2;

    const dots = this.add.graphics().setDepth(5);
    objects.push(dots);
    const textWidth = width - BOOK.dot;
    page.lines.forEach((line, index) => {
      const text = addText(this, 0, 0, line, { size, wrapWidth: textWidth }).setDepth(5);
      const lineTop = height;
      objects.push(text);
      placers.push((x, y) => {
        text.setPosition(x + BOOK.dot, y + lineTop);
        dots.fillStyle(THEME.pinkDeep, 1).fillCircle(x + 3, y + lineTop + 1 + size * 0.55, 2);
      });
      height += Math.ceil(text.height) + (index < page.lines.length - 1 ? BOOK.gap : 0);
    });

    return {
      height,
      place: (x, y) => placers.forEach((placeAt) => placeAt(x, y)),
      destroy: () => objects.forEach((object) => object.destroy()),
    };
  }

  /** 카드 줄 하나를 컨테이너에 그린다. 컨테이너의 (0, 0)이 줄의 왼쪽 위다. */
  private drawRow(tokens: readonly ParsedToken[]): { container: Phaser.GameObjects.Container; width: number } {
    const container = this.add.container(0, 0).setDepth(5);
    let x = 0;
    tokens.forEach((token, index) => {
      if (index > 0) x += CARD.gap;
      x += this.drawToken(container, token, x);
    });
    return { container, width: x };
  }

  /** 그림 하나를 x에 그리고 차지한 폭을 돌려준다. */
  private drawToken(container: Phaser.GameObjects.Container, token: ParsedToken, x: number): number {
    if (token.kind === 'text') {
      const text = addText(this, x, CARD.h / 2, token.text, { size: 14, color: THEME_CSS.ink, originY: 0.5 });
      container.add(text);
      return Math.ceil(text.width);
    }
    if (token.kind === 'arrow') {
      const g = this.add.graphics().fillStyle(INK.line, 1);
      const midY = CARD.h / 2;
      g.fillRect(x + 1, midY - 1.5, 9, 3);
      g.fillTriangle(x + 9, midY - 5, x + 15, midY, x + 9, midY + 5);
      container.add(g);
      return 16;
    }

    if (token.kind === 'stone') return this.drawStone(container, token.color, token.mark, x);

    const y = token.mark === 'focus' ? -CARD.lift : 0;
    const g = this.add.graphics();
    if (token.mark === 'focus') {
      g.fillStyle(THEME.gold, 1).fillRoundedRect(x - 2, y - 2, CARD.w + 4, CARD.h + 4, CARD.radius + 2);
    }
    // 아래로 깔리는 그림자, 테두리, 흰 면
    g.fillStyle(THEME.shadow, 1).fillRoundedRect(x, y + 2, CARD.w, CARD.h, CARD.radius);
    g.fillStyle(INK.line, 1).fillRoundedRect(x, y, CARD.w, CARD.h, CARD.radius);
    container.add(g);
    const parts: Phaser.GameObjects.GameObject[] = [g];

    if (token.kind === 'back') {
      g.fillStyle(INK.back, 1).fillRoundedRect(x + 1, y + 1, CARD.w - 2, CARD.h - 2, CARD.radius - 1);
      g.fillStyle(INK.backSoft, 1);
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if ((row + col) % 2 === 0) g.fillRect(x + 5 + col * 6, y + 5 + row * 6, 3, 3);
        }
      }
    } else {
      g.fillStyle(THEME.white, 1).fillRoundedRect(x + 1, y + 1, CARD.w - 2, CARD.h - 2, CARD.radius - 1);
      if (token.kind === 'card') {
        const red = RED_SUITS.includes(token.suit);
        const label = addText(this, x + CARD.w / 2, y + 10, token.rank, {
          size: token.rank === '10' ? 11 : 13,
          color: red ? INK_CSS.red : INK_CSS.black,
          originX: 0.5,
          originY: 0.5,
        });
        container.add(label);
        parts.push(label);
        g.fillStyle(red ? INK.red : INK.black, 1);
        drawSuit(g, token.suit, x + CARD.w / 2, y + 24, 11);
      } else {
        const color = token.color ? INK.red : INK.black;
        const label = addText(this, x + CARD.w / 2, y + 9, '조커', {
          size: 8,
          color: token.color ? INK_CSS.red : INK_CSS.black,
          originX: 0.5,
          originY: 0.5,
        });
        container.add(label);
        parts.push(label);
        drawStar(g, x + CARD.w / 2, y + 23, 7, token.color ? [0xff8f8f, 0xffcf5c, 0x7fd3ae, 0x7dbef2, 0x9684e0] : [color]);
      }
    }
    if (token.mark === 'dim') {
      for (const part of parts) (part as Phaser.GameObjects.Graphics).setAlpha(0.35);
      // 흐린 카드에는 못 놓는다는 뜻으로 X를 긋는다.
      const cross = this.add.graphics().lineStyle(2.5, INK.red, 0.9);
      cross.lineBetween(x + 5, y + 8, x + CARD.w - 5, y + CARD.h - 8);
      cross.lineBetween(x + CARD.w - 5, y + 8, x + 5, y + CARD.h - 8);
      container.add(cross);
    }
    return CARD.w;
  }

  /**
   * 오목의 돌 하나를 나무 판 한 칸 위에 그린다. 빈 점은 줄이 만나는 자리만 보인다.
   * 눈에 띄게 한 돌(방금 둔 수)은 노란 테를 두른다.
   */
  private drawStone(container: Phaser.GameObjects.Container, color: StoneColor, mark: Mark, x: number): number {
    const size = CARD.w;
    const top = (CARD.h - size) / 2;
    const cx = x + size / 2;
    const cy = top + size / 2;
    const g = this.add.graphics();
    g.fillStyle(STONE.wood, 1).fillRect(x - CARD.gap / 2, top, size + CARD.gap, size);
    g.fillStyle(STONE.line, 1).fillRect(x - CARD.gap / 2, cy - 0.5, size + CARD.gap, 1).fillRect(cx - 0.5, top, 1, size);
    const r = size / 2 - 2;
    if (mark === 'focus') g.fillStyle(THEME.gold, 1).fillCircle(cx, cy, r + 2.5);
    if (color === 'black') {
      g.fillStyle(STONE.black, 1).fillCircle(cx, cy, r);
      g.fillStyle(STONE.blackShine, 1).fillCircle(cx - r * 0.35, cy - r * 0.35, r * 0.28);
    } else if (color === 'white') {
      g.fillStyle(STONE.whiteEdge, 1).fillCircle(cx, cy, r);
      g.fillStyle(THEME.white, 1).fillCircle(cx - 0.5, cy - 0.8, r - 1.2);
    }
    if (mark === 'dim') g.setAlpha(0.35);
    container.add(g);
    return size;
  }
}

/** 규칙 안내서의 오목 그림에 쓰는 색 */
const STONE = { wood: 0xffd08a, line: 0xb07a3c, black: 0x3a2d3a, blackShine: 0x8a7590, whiteEdge: 0xc9bcf8 } as const;

/** 무늬 하나를 (cx, cy)를 가운데로 size 크기에 칠한다. 색은 미리 fillStyle로 정해 둔다. */
function drawSuit(g: Phaser.GameObjects.Graphics, suit: Suit, cx: number, cy: number, size: number): void {
  const s = size / 2;
  if (suit === 'D') {
    g.fillPoints([new Phaser.Math.Vector2(cx, cy - s), new Phaser.Math.Vector2(cx + s * 0.75, cy), new Phaser.Math.Vector2(cx, cy + s), new Phaser.Math.Vector2(cx - s * 0.75, cy)], true);
    return;
  }
  if (suit === 'H') {
    const r = s * 0.52;
    g.fillCircle(cx - r * 0.95, cy - s * 0.3, r);
    g.fillCircle(cx + r * 0.95, cy - s * 0.3, r);
    g.fillTriangle(cx - s * 0.98, cy - s * 0.12, cx + s * 0.98, cy - s * 0.12, cx, cy + s);
    return;
  }
  if (suit === 'S') {
    const r = s * 0.5;
    g.fillCircle(cx - r * 0.95, cy + s * 0.18, r);
    g.fillCircle(cx + r * 0.95, cy + s * 0.18, r);
    g.fillTriangle(cx - s * 0.97, cy + s * 0.05, cx + s * 0.97, cy + s * 0.05, cx, cy - s);
    g.fillTriangle(cx, cy + s * 0.2, cx - s * 0.4, cy + s, cx + s * 0.4, cy + s);
    return;
  }
  const r = s * 0.42;
  g.fillCircle(cx, cy - s * 0.48, r);
  g.fillCircle(cx - s * 0.48, cy + s * 0.08, r);
  g.fillCircle(cx + s * 0.48, cy + s * 0.08, r);
  g.fillRect(cx - s * 0.2, cy - s * 0.3, s * 0.4, s * 0.6);
  g.fillTriangle(cx, cy + s * 0.1, cx - s * 0.4, cy + s, cx + s * 0.4, cy + s);
}

/** 다섯 꼭짓점 별. 색을 여럿 주면 꼭짓점마다 다른 색으로 칠한다(컬러 조커). */
function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, radius: number, colors: readonly number[]): void {
  const inner = radius * 0.45;
  const point = (index: number, r: number): Phaser.Math.Vector2 => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return new Phaser.Math.Vector2(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  };
  for (let tip = 0; tip < 5; tip += 1) {
    g.fillStyle(colors[tip % colors.length], 1);
    const a = point(tip * 2 - 1, inner);
    const b = point(tip * 2, radius);
    const c = point(tip * 2 + 1, inner);
    g.fillTriangle(cx, cy, a.x, a.y, b.x, b.y);
    g.fillTriangle(cx, cy, b.x, b.y, c.x, c.y);
  }
}
