/**
 * 등불지기 한 판의 시뮬레이션. 화면(Phaser)과 떨어져 있어서 테스트에서 그대로 돌릴 수 있고,
 * 상태(RunState)가 평범한 데이터라서 그대로 저장했다가 이어서 할 수 있다.
 */
import {
  ENEMIES,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  PLAYER_BASE,
  RUN_SECONDS,
  SURGES,
  type EnemyKind,
  type MetaId,
  type PassiveId,
  type WeaponId,
} from './data';
import {
  auraStats,
  boltStats,
  damageScale,
  EMBER_BONUS,
  emberStats,
  enemyHp,
  fireflyStats,
  HEAL_AMOUNT,
  isEvolved,
  lanceStats,
  maxAlive,
  midBossTier,
  modifiers,
  oilStats,
  pickSpawnKind,
  spawnPerSecond,
  speedScale,
  starStats,
  ticketOptions,
  upgradeOptions,
  xpToNext,
  type Levels,
  type Modifiers,
  type Rand,
  type RunSummary,
  type Upgrade,
} from './rules';

export const RUN_STATE_VERSION = 2;

export interface Enemy {
  uid: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 맞아서 하얗게 보이는 남은 시간(초) */
  flash: number;
  /** 느려진 남은 시간(초) */
  slow: number;
  /** 느려져 있는 동안의 이동 속도 배율 */
  slowTo: number;
  /** 반딧불에 다시 맞을 수 있을 때까지(초) */
  fireflyCd: number;
  /** 보스의 다음 행동까지(초) */
  timer: number;
  /** 보스의 상태. 0 쫓기, 1 힘 모으기, 2 돌진 */
  mode: number;
  /** 몇 번째 중간 보스인지(0부터). 다른 적은 0 */
  tier: number;
  vx: number;
  vy: number;
}

/** 날아가는 것의 생김새. 화면에서 그림을 고를 때 쓴다. */
export type ShotLook = 'ember' | 'emberEvo' | 'lance' | 'lanceEvo';

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  pierce: number;
  life: number;
  /** 판정 반지름(px) */
  radius: number;
  look: ShotLook;
  /** 이미 맞힌 적. 관통할 때 같은 적을 두 번 때리지 않는다. */
  hit: number[];
}

export interface Gem {
  x: number;
  y: number;
  /** 경험치. kind가 heal이면 회복량 */
  value: number;
  kind: 'xp' | 'heal';
  /** 끌려오는 중인지 */
  pulled: boolean;
}

export interface Strike {
  x: number;
  y: number;
  delay: number;
  radius: number;
  damage: number;
  evolved: boolean;
}

/** 등잔 기름이 남긴 불길 */
export interface Fire {
  x: number;
  y: number;
  radius: number;
  /** 남은 시간(초) */
  life: number;
  /** 다음에 태울 때까지(초) */
  tick: number;
  /** 태우는 간격(초) */
  every: number;
  damage: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
  evolved: boolean;
}

export interface RunState {
  version: number;
  /** 지난 시간(초) */
  t: number;
  viewW: number;
  viewH: number;
  /** 이 판을 시작할 때의 영구 강화 */
  meta: Levels<MetaId>;
  player: {
    x: number;
    y: number;
    hp: number;
    /** 남은 무적 시간(초) */
    inv: number;
    face: 1 | -1;
    moving: boolean;
    level: number;
    xp: number;
  };
  weapons: Levels<WeaponId>;
  passives: Levels<PassiveId>;
  enemies: Enemy[];
  shots: Shot[];
  gems: Gem[];
  strikes: Strike[];
  fires: Fire[];
  cd: { ember: number; aura: number; star: number; lance: number; oil: number; bolt: number };
  fireflyAngle: number;
  spawnDebt: number;
  surgeIndex: number;
  /** 지금까지 나온 중간 보스의 수 */
  midBosses: number;
  finalBoss: boolean;
  kills: number;
  bossKills: number;
  bonusEmbers: number;
  /** 아직 고르지 않은 레벨업 횟수. 0보다 크면 시뮬레이션이 멈춘다. */
  pendingLevelUps: number;
  /** 아직 쓰지 않은 무기 강화권. 0보다 크면 시뮬레이션이 멈춘다. */
  pendingTickets: number;
  nextUid: number;
  over: null | 'dead' | 'cleared';
}

export type SimEvent =
  | { type: 'kill'; x: number; y: number; boss: boolean }
  | { type: 'hurt' }
  | { type: 'gem' }
  | { type: 'heal' }
  | { type: 'levelup' }
  | { type: 'shoot' }
  | { type: 'strike'; x: number; y: number; radius: number }
  /** 번갯불이 지나간 길. points는 x, y가 번갈아 들어 있다. */
  | { type: 'bolt'; points: number[]; evolved: boolean }
  | { type: 'boss'; kind: EnemyKind }
  | { type: 'ticket' }
  | { type: 'surge' };

export interface RunConfig {
  viewW: number;
  viewH: number;
  meta: Levels<MetaId>;
}

const CELL = 20;
const BUCKETS = 4096;
const EMBER_RADIUS = 3;
const FIREFLY_RADIUS = 4;
const EMBER_RANGE = 130;
const LANCE_RANGE = 170;
/** 꿰뚫는 화살은 사라질 때까지 몇이든 꿰뚫는다. */
const PIERCE_ALL = 9999;
const GEM_LIMIT = 220;
const GEM_PICKUP = 7;
const GEM_SPEED = 170;
const SPAWN_MARGIN = 14;
/** 쓰러진 적이 회복 떡을 떨어뜨릴 확률 */
const HEAL_DROP_CHANCE = 0.008;
const HEAL_DROP_VALUE = 15;

export function createRun(config: RunConfig): RunState {
  const mods = modifiers({}, config.meta);
  return {
    version: RUN_STATE_VERSION,
    t: 0,
    viewW: config.viewW,
    viewH: config.viewH,
    meta: { ...config.meta },
    player: { x: 0, y: 0, hp: mods.maxHp, inv: 0, face: 1, moving: false, level: 1, xp: 0 },
    weapons: { ember: 1 },
    passives: {},
    enemies: [],
    shots: [],
    gems: [],
    strikes: [],
    fires: [],
    cd: { ember: 0.6, aura: 0, star: 1, lance: 0.8, oil: 0.5, bolt: 0.7 },
    fireflyAngle: 0,
    spawnDebt: 0,
    surgeIndex: 0,
    midBosses: 0,
    finalBoss: false,
    kills: 0,
    bossKills: 0,
    bonusEmbers: 0,
    pendingLevelUps: 0,
    pendingTickets: 0,
    nextUid: 1,
    over: null,
  };
}

/** 저장해 둔 판이 이어서 할 수 있는 모양인지 대강 확인한다. */
export function looksLikeRun(raw: unknown): raw is RunState {
  if (typeof raw !== 'object' || raw === null) return false;
  const run = raw as Partial<RunState>;
  return (
    run.version === RUN_STATE_VERSION &&
    typeof run.t === 'number' &&
    run.over === null &&
    typeof run.player === 'object' &&
    run.player !== null &&
    Array.isArray(run.enemies) &&
    Array.isArray(run.gems) &&
    Array.isArray(run.shots) &&
    Array.isArray(run.strikes) &&
    Array.isArray(run.fires)
  );
}

export class Sim {
  /** step()을 부를 때마다 비워지고 그 사이에 일어난 일이 쌓인다. */
  readonly events: SimEvent[] = [];
  mods: Modifiers;

  private readonly heads = new Int32Array(BUCKETS);
  private next = new Int32Array(512);

  constructor(
    readonly state: RunState,
    private readonly rand: Rand,
  ) {
    this.mods = modifiers(state.passives, state.meta);
  }

  get maxHp(): number {
    return this.mods.maxHp;
  }

  get magnetRadius(): number {
    return PLAYER_BASE.magnet * this.mods.magnet;
  }

  /** 난이도를 정하는 시각. 마지막 보스가 나온 뒤에는 더 어려워지지 않는다. */
  private get clock(): number {
    return Math.min(this.state.t, RUN_SECONDS);
  }

  /** 레벨업 선택지를 뽑는다. */
  options(): Upgrade[] {
    return upgradeOptions({ weapons: this.state.weapons, passives: this.state.passives }, this.rand);
  }

  /** 레벨업에서 고른 강화를 반영한다. */
  applyUpgrade(upgrade: Upgrade): void {
    const s = this.state;
    if (s.pendingLevelUps > 0) s.pendingLevelUps -= 1;
    this.grant(upgrade);
  }

  /** 무기 강화권으로 고를 수 있는 것 */
  ticketChoices(): Upgrade[] {
    return ticketOptions(this.state.weapons);
  }

  /** 무기 강화권을 한 장 써서 고른 것을 반영한다. */
  useTicket(upgrade: Upgrade): void {
    const s = this.state;
    if (s.pendingTickets > 0) s.pendingTickets -= 1;
    this.grant(upgrade);
  }

  private grant(upgrade: Upgrade): void {
    const s = this.state;
    switch (upgrade.type) {
      case 'weapon':
        s.weapons[upgrade.id] = upgrade.level;
        break;
      case 'passive':
        s.passives[upgrade.id] = upgrade.level;
        break;
      case 'heal':
        s.player.hp += HEAL_AMOUNT;
        break;
      case 'embers':
        s.bonusEmbers += EMBER_BONUS;
        break;
    }
    this.mods = modifiers(s.passives, s.meta);
    // 외투는 늘어난 만큼 바로 채워 준다.
    if (upgrade.type === 'passive' && upgrade.id === 'coat') s.player.hp += 20;
    s.player.hp = Math.min(s.player.hp, this.mods.maxHp);
  }

  summary(): RunSummary {
    const s = this.state;
    return {
      seconds: Math.min(s.t, RUN_SECONDS),
      kills: s.kills,
      level: s.player.level,
      bossKills: s.bossKills,
      cleared: s.over === 'cleared',
      bonusEmbers: s.bonusEmbers,
    };
  }

  /**
   * dt초만큼 진행한다. moveX, moveY는 길이가 1 이하인 이동 방향.
   * 레벨업이나 강화권 선택을 기다리는 중이거나 판이 끝났으면 아무 일도 하지 않는다.
   */
  step(dt: number, moveX: number, moveY: number): void {
    this.events.length = 0;
    const s = this.state;
    if (s.over || s.pendingLevelUps > 0 || s.pendingTickets > 0) return;

    s.t += dt;
    this.movePlayer(dt, moveX, moveY);
    this.spawn(dt);
    this.buildGrid();
    this.moveEnemies(dt);
    if (s.over) return;
    this.fireWeapons(dt);
    this.moveShots(dt);
    this.landStrikes(dt);
    this.burnFires(dt);
    this.reap();
    this.moveGems(dt);
  }

  // ------------------------------------------------------------ 플레이어

  private movePlayer(dt: number, moveX: number, moveY: number): void {
    const p = this.state.player;
    const length = Math.hypot(moveX, moveY);
    p.moving = length > 0.05;
    if (p.moving) {
      const scale = (PLAYER_BASE.speed * this.mods.speed * dt) / Math.max(1, length);
      p.x += moveX * scale;
      p.y += moveY * scale;
      if (Math.abs(moveX) > 0.15) p.face = moveX > 0 ? 1 : -1;
    }
    if (p.inv > 0) p.inv -= dt;
  }

  // ------------------------------------------------------------ 적 등장

  private makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const s = this.state;
    const hp = enemyHp(kind, this.clock);
    const enemy: Enemy = {
      uid: s.nextUid,
      kind,
      x,
      y,
      hp,
      maxHp: hp,
      flash: 0,
      slow: 0,
      slowTo: 1,
      fireflyCd: 0,
      timer: kind === 'giant' ? 5 : kind === 'lord' ? 3 : 0,
      mode: 0,
      tier: 0,
      vx: 0,
      vy: 0,
    };
    s.nextUid += 1;
    s.enemies.push(enemy);
    return enemy;
  }

  /** 화면 바로 밖, 플레이어를 둘러싼 네모 테두리 위의 한 점 */
  private edgePoint(): [number, number] {
    const s = this.state;
    const halfW = s.viewW / 2 + SPAWN_MARGIN;
    const halfH = s.viewH / 2 + SPAWN_MARGIN;
    const along = this.rand() * 2 - 1;
    const horizontal = this.rand() * (halfW + halfH) < halfW;
    const sign = this.rand() < 0.5 ? -1 : 1;
    return horizontal
      ? [s.player.x + along * halfW, s.player.y + sign * halfH]
      : [s.player.x + sign * halfW, s.player.y + along * halfH];
  }

  private spawn(dt: number): void {
    const s = this.state;
    const t = this.clock;

    s.spawnDebt += spawnPerSecond(t) * dt;
    const limit = maxAlive(t);
    while (s.spawnDebt >= 1) {
      if (s.enemies.length >= limit) {
        s.spawnDebt = Math.min(s.spawnDebt, 1);
        break;
      }
      s.spawnDebt -= 1;
      const [x, y] = this.edgePoint();
      this.makeEnemy(pickSpawnKind(t, this.rand), x, y);
    }

    // 밀물: 화면 가장자리를 따라 둥글게 에워싼다.
    if (s.surgeIndex < SURGES.length && s.t >= SURGES[s.surgeIndex]) {
      s.surgeIndex += 1;
      const count = 18 + 6 * s.surgeIndex;
      const kind: EnemyKind = s.surgeIndex >= 3 ? 'wisp' : 'shade';
      const rx = s.viewW / 2 + SPAWN_MARGIN;
      const ry = s.viewH / 2 + SPAWN_MARGIN;
      const offset = this.rand() * Math.PI * 2;
      for (let i = 0; i < count; i += 1) {
        const angle = offset + (i / count) * Math.PI * 2;
        this.makeEnemy(kind, s.player.x + Math.cos(angle) * rx, s.player.y + Math.sin(angle) * ry);
      }
      this.events.push({ type: 'surge' });
    }

    // 중간 보스: 정해진 간격마다 하나씩, 나올 때마다 더 강하게
    if (s.midBosses < MID_BOSS_COUNT && s.t >= (s.midBosses + 1) * MID_BOSS_EVERY) {
      const boss = this.spawnBoss('giant');
      boss.tier = s.midBosses;
      boss.hp = midBossTier(boss.tier).hp;
      boss.maxHp = boss.hp;
      s.midBosses += 1;
    }
    if (!s.finalBoss && s.t >= RUN_SECONDS) {
      s.finalBoss = true;
      this.spawnBoss('lord');
    }
  }

  private spawnBoss(kind: EnemyKind): Enemy {
    const s = this.state;
    // 보스는 위쪽에서 내려온다.
    const boss = this.makeEnemy(kind, s.player.x, s.player.y - s.viewH / 2 - 24);
    this.events.push({ type: 'boss', kind });
    return boss;
  }

  // ------------------------------------------------------------ 격자

  private bucket(x: number, y: number): number {
    return (Math.floor(x / CELL) & 63) | ((Math.floor(y / CELL) & 63) << 6);
  }

  private buildGrid(): void {
    const enemies = this.state.enemies;
    if (this.next.length < enemies.length) {
      this.next = new Int32Array(Math.max(enemies.length, this.next.length * 2));
    }
    this.heads.fill(-1);
    for (let i = 0; i < enemies.length; i += 1) {
      const b = this.bucket(enemies[i].x, enemies[i].y);
      this.next[i] = this.heads[b];
      this.heads[b] = i;
    }
  }

  // ------------------------------------------------------------ 적 이동

  private moveEnemies(dt: number): void {
    const s = this.state;
    const p = s.player;
    const enemies = s.enemies;
    // buildGrid 뒤에 생긴 적은 격자에 없으므로 그때의 수까지만 이웃으로 본다.
    const gridCount = enemies.length;
    const recycle = Math.max(s.viewW, s.viewH) * 0.5 + 90;
    const fast = speedScale(this.clock);
    const hard = damageScale(this.clock);

    for (let i = 0; i < gridCount; i += 1) {
      const e = enemies[i];
      if (e.hp <= 0) continue;
      const info = ENEMIES[e.kind];
      if (e.flash > 0) e.flash -= dt;
      if (e.slow > 0) e.slow -= dt;
      if (e.fireflyCd > 0) e.fireflyCd -= dt;

      let dx = p.x - e.x;
      let dy = p.y - e.y;
      let distance = Math.hypot(dx, dy) || 0.001;

      // 너무 멀어진 적은 화면 가장자리로 다시 데려온다.
      if (!info.boss && distance > recycle) {
        [e.x, e.y] = this.edgePoint();
        dx = p.x - e.x;
        dy = p.y - e.y;
        distance = Math.hypot(dx, dy) || 0.001;
      }

      let speed = info.speed * (info.boss ? 1 : fast) * (e.slow > 0 ? e.slowTo : 1);
      let dirX = dx / distance;
      let dirY = dy / distance;

      if (info.boss) {
        // 보스가 화면 밖으로 멀리 떨어지면 서둘러 따라온다.
        if (distance > recycle) speed *= 4;
        e.timer -= dt;
        if (e.kind === 'giant' && e.timer <= 0) {
          const tier = midBossTier(e.tier);
          e.timer = 7;
          this.summon(e, tier.minion, tier.summon, 26);
        } else if (e.kind === 'lord') {
          if (e.mode === 0 && e.timer <= 0) {
            e.mode = 1;
            e.timer = 0.7;
          } else if (e.mode === 1) {
            speed = 0;
            e.flash = 0.05;
            if (e.timer <= 0) {
              e.mode = 2;
              e.timer = 0.75;
              e.vx = dirX;
              e.vy = dirY;
            }
          } else if (e.mode === 2) {
            speed = 125;
            dirX = e.vx;
            dirY = e.vy;
            if (e.timer <= 0) {
              e.mode = 0;
              e.timer = 4.2;
              this.summon(e, 'wisp', 6, 30);
            }
          }
        }
      }

      e.x += dirX * speed * dt;
      e.y += dirY * speed * dt;

      // 서로 겹치지 않게 조금씩 밀어낸다. 보스는 밀리지 않는다.
      if (!info.boss) {
        const cx = Math.floor(e.x / CELL);
        const cy = Math.floor(e.y / CELL);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            let j = this.heads[((cx + ox) & 63) | (((cy + oy) & 63) << 6)];
            while (j !== -1) {
              const other = enemies[j];
              if (j !== i && other.hp > 0) {
                const sx = e.x - other.x;
                const sy = e.y - other.y;
                const gap = (info.radius + ENEMIES[other.kind].radius) * 0.85;
                const d2 = sx * sx + sy * sy;
                if (d2 < gap * gap && d2 > 0.0001) {
                  const d = Math.sqrt(d2);
                  const push = ((gap - d) / d) * 0.35;
                  e.x += sx * push;
                  e.y += sy * push;
                }
              }
              j = this.next[j];
            }
          }
        }
      }

      // 플레이어에 닿으면 피해를 준다.
      const reach = info.radius + PLAYER_BASE.radius;
      const px = p.x - e.x;
      const py = p.y - e.y;
      if (p.inv <= 0 && px * px + py * py < reach * reach) {
        p.hp -= info.boss ? info.damage : Math.round(info.damage * hard);
        p.inv = PLAYER_BASE.invulnerable;
        this.events.push({ type: 'hurt' });
        if (p.hp <= 0) {
          p.hp = 0;
          s.over = 'dead';
          return;
        }
      }
    }
  }

  private summon(source: Enemy, kind: EnemyKind, count: number, radius: number): void {
    const offset = this.rand() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      const angle = offset + (i / count) * Math.PI * 2;
      this.makeEnemy(kind, source.x + Math.cos(angle) * radius, source.y + Math.sin(angle) * radius);
    }
  }

  // ------------------------------------------------------------ 무기

  private damage(enemy: Enemy, amount: number, flash = 0.09): void {
    enemy.hp -= amount;
    enemy.flash = flash;
  }

  /** 잠깐 느리게 한다. 이미 더 느려져 있으면 그 배율을 지킨다. */
  private chill(enemy: Enemy, factor: number): void {
    if (factor >= 1) return;
    enemy.slowTo = enemy.slow > 0 ? Math.min(enemy.slowTo, factor) : factor;
    enemy.slow = 0.7;
  }

  private fireWeapons(dt: number): void {
    const s = this.state;
    const p = s.player;
    const enemies = s.enemies;
    const w = s.weapons;

    if (w.ember) {
      s.cd.ember -= dt;
      if (s.cd.ember <= 0) {
        let target: Enemy | null = null;
        let best = EMBER_RANGE * EMBER_RANGE;
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d2 < best) {
            best = d2;
            target = e;
          }
        }
        if (target) {
          const stats = emberStats(w.ember, this.mods);
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          const look: ShotLook = isEvolved(w.ember) ? 'emberEvo' : 'ember';
          for (let i = 0; i < stats.count; i += 1) {
            const angle = base + (i - (stats.count - 1) / 2) * 0.22;
            s.shots.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * stats.speed,
              vy: Math.sin(angle) * stats.speed,
              damage: stats.damage,
              pierce: stats.pierce,
              life: 1,
              radius: EMBER_RADIUS,
              look,
              hit: [],
            });
          }
          s.cd.ember = stats.cooldown;
          this.events.push({ type: 'shoot' });
        } else {
          s.cd.ember = 0.1;
        }
      }
    }

    if (w.aura) {
      s.cd.aura -= dt;
      if (s.cd.aura <= 0) {
        const stats = auraStats(w.aura, this.mods);
        s.cd.aura = stats.tick;
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const reach = stats.radius + ENEMIES[e.kind].radius;
          if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < reach * reach) {
            // 고리 안의 적이 한꺼번에 번쩍여 화면을 가리지 않게 짧게만 깜빡인다.
            this.damage(e, stats.damage, 0.04);
            this.chill(e, stats.slow);
          }
        }
      }
    }

    if (w.firefly) {
      const stats = fireflyStats(w.firefly, this.mods);
      s.fireflyAngle = (s.fireflyAngle + stats.spin * dt) % (Math.PI * 2);
      for (let k = 0; k < stats.count; k += 1) {
        const angle = s.fireflyAngle + (k / stats.count) * Math.PI * 2;
        const fx = p.x + Math.cos(angle) * stats.orbit;
        const fy = p.y + Math.sin(angle) * stats.orbit;
        for (const e of enemies) {
          if (e.hp <= 0 || e.fireflyCd > 0) continue;
          const reach = FIREFLY_RADIUS + ENEMIES[e.kind].radius;
          if ((e.x - fx) ** 2 + (e.y - fy) ** 2 < reach * reach) {
            this.damage(e, stats.damage);
            e.fireflyCd = stats.rehit;
          }
        }
      }
    }

    if (w.star) {
      s.cd.star -= dt;
      if (s.cd.star <= 0) {
        const stats = starStats(w.star, this.mods);
        const halfW = s.viewW / 2 - 6;
        const halfH = s.viewH / 2 - 6;
        const seen = enemies.filter(
          (e) => e.hp > 0 && Math.abs(e.x - p.x) < halfW && Math.abs(e.y - p.y) < halfH,
        );
        if (seen.length === 0) {
          s.cd.star = 0.2;
        } else {
          for (let i = 0; i < stats.count; i += 1) {
            const target = seen[Math.floor(this.rand() * seen.length)];
            s.strikes.push({
              x: target.x,
              y: target.y,
              delay: 0.35 + i * 0.12,
              radius: stats.radius,
              damage: stats.damage,
              evolved: isEvolved(w.star),
            });
          }
          s.cd.star = stats.cooldown;
        }
      }
    }

    if (w.lance) {
      s.cd.lance -= dt;
      if (s.cd.lance <= 0) {
        // 닿는 거리 안에서 체력이 가장 많은 적을 겨눈다. 그 사이에 있는 적은 모두 꿰뚫는다.
        let target: Enemy | null = null;
        for (const e of enemies) {
          if (e.hp <= 0 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > LANCE_RANGE * LANCE_RANGE) continue;
          if (!target || e.hp > target.hp) target = e;
        }
        if (target) {
          const stats = lanceStats(w.lance, this.mods);
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          const look: ShotLook = isEvolved(w.lance) ? 'lanceEvo' : 'lance';
          for (let i = 0; i < stats.count; i += 1) {
            const angle = base + (i - (stats.count - 1) / 2) * 0.2;
            s.shots.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * stats.speed,
              vy: Math.sin(angle) * stats.speed,
              damage: stats.damage,
              pierce: PIERCE_ALL,
              life: stats.life,
              radius: stats.radius,
              look,
              hit: [],
            });
          }
          s.cd.lance = stats.cooldown;
          this.events.push({ type: 'shoot' });
        } else {
          s.cd.lance = 0.15;
        }
      }
    }

    if (w.oil) {
      s.cd.oil -= dt;
      if (s.cd.oil <= 0) {
        const stats = oilStats(w.oil, this.mods);
        s.cd.oil = stats.cooldown;
        // 서 있던 자리에 이미 불길이 있으면 겹쳐 쌓지 않고 그 불길을 다시 살린다.
        const here = s.fires.find((fire) => (fire.x - p.x) ** 2 + (fire.y - p.y) ** 2 < (fire.radius * 0.5) ** 2);
        if (here) {
          here.life = stats.duration;
          here.radius = stats.radius;
          here.damage = stats.damage;
          here.slow = stats.slow;
          here.evolved = isEvolved(w.oil);
        } else {
          s.fires.push({
            x: p.x,
            y: p.y,
            radius: stats.radius,
            life: stats.duration,
            tick: 0,
            every: stats.tick,
            damage: stats.damage,
            slow: stats.slow,
            evolved: isEvolved(w.oil),
          });
        }
      }
    }

    if (w.bolt) {
      s.cd.bolt -= dt;
      if (s.cd.bolt <= 0) {
        const stats = boltStats(w.bolt, this.mods);
        const struck: Enemy[] = [];
        for (let chain = 0; chain < stats.chains; chain += 1) {
          // 플레이어에게서 가장 가까운 적을 치고, 거기서 가까운 다음 적으로 튄다.
          const points = [p.x, p.y];
          let fromX = p.x;
          let fromY = p.y;
          let range = stats.reach;
          for (let jump = 0; jump < stats.jumps; jump += 1) {
            let target: Enemy | null = null;
            let best = range * range;
            for (const e of enemies) {
              if (e.hp <= 0 || struck.includes(e)) continue;
              const d2 = (e.x - fromX) ** 2 + (e.y - fromY) ** 2;
              if (d2 < best) {
                best = d2;
                target = e;
              }
            }
            if (!target) break;
            struck.push(target);
            this.damage(target, stats.damage);
            points.push(target.x, target.y);
            fromX = target.x;
            fromY = target.y;
            range = stats.hop;
          }
          if (points.length > 2) this.events.push({ type: 'bolt', points, evolved: isEvolved(w.bolt) });
        }
        s.cd.bolt = struck.length > 0 ? stats.cooldown : 0.15;
      }
    }
  }

  private moveShots(dt: number): void {
    const s = this.state;
    const enemies = s.enemies;
    let kept = 0;
    for (const shot of s.shots) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      let alive = shot.life > 0;

      const cx = Math.floor(shot.x / CELL);
      const cy = Math.floor(shot.y / CELL);
      for (let oy = -1; alive && oy <= 1; oy += 1) {
        for (let ox = -1; alive && ox <= 1; ox += 1) {
          let j = this.heads[((cx + ox) & 63) | (((cy + oy) & 63) << 6)];
          while (j !== -1) {
            const e = enemies[j];
            j = this.next[j];
            if (e.hp <= 0 || shot.hit.includes(e.uid)) continue;
            const reach = shot.radius + ENEMIES[e.kind].radius;
            const dx = e.x - shot.x;
            const dy = e.y - shot.y;
            if (dx * dx + dy * dy >= reach * reach) continue;
            this.damage(e, shot.damage);
            // 맞은 적은 살짝 밀려난다.
            if (!ENEMIES[e.kind].boss) {
              const speed = Math.hypot(shot.vx, shot.vy) || 1;
              e.x += (shot.vx / speed) * 2;
              e.y += (shot.vy / speed) * 2;
            }
            shot.hit.push(e.uid);
            shot.pierce -= 1;
            if (shot.pierce < 0) {
              alive = false;
              break;
            }
          }
        }
      }
      if (alive) {
        s.shots[kept] = shot;
        kept += 1;
      }
    }
    s.shots.length = kept;
  }

  private landStrikes(dt: number): void {
    const s = this.state;
    let kept = 0;
    for (const strike of s.strikes) {
      strike.delay -= dt;
      if (strike.delay > 0) {
        s.strikes[kept] = strike;
        kept += 1;
        continue;
      }
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const reach = strike.radius + ENEMIES[e.kind].radius;
        if ((e.x - strike.x) ** 2 + (e.y - strike.y) ** 2 < reach * reach) {
          this.damage(e, strike.damage);
        }
      }
      this.events.push({ type: 'strike', x: strike.x, y: strike.y, radius: strike.radius });
    }
    s.strikes.length = kept;
  }

  private burnFires(dt: number): void {
    const s = this.state;
    let kept = 0;
    for (const fire of s.fires) {
      fire.life -= dt;
      fire.tick -= dt;
      if (fire.tick <= 0) {
        fire.tick += fire.every;
        for (const e of s.enemies) {
          if (e.hp <= 0) continue;
          const reach = fire.radius + ENEMIES[e.kind].radius;
          if ((e.x - fire.x) ** 2 + (e.y - fire.y) ** 2 < reach * reach) {
            this.damage(e, fire.damage, 0.04);
            this.chill(e, fire.slow);
          }
        }
      }
      if (fire.life > 0) {
        s.fires[kept] = fire;
        kept += 1;
      }
    }
    s.fires.length = kept;
  }

  // ------------------------------------------------------------ 정리와 보상

  /** 쓰러진 적을 치우고 빛 조각을 떨어뜨린다. 순서를 지켜 줄여서 그리는 순서가 흔들리지 않게 한다. */
  private reap(): void {
    const s = this.state;
    let kept = 0;
    for (const e of s.enemies) {
      if (e.hp > 0) {
        s.enemies[kept] = e;
        kept += 1;
        continue;
      }
      const info = ENEMIES[e.kind];
      s.kills += 1;
      this.events.push({ type: 'kill', x: e.x, y: e.y, boss: Boolean(info.boss) });
      if (info.xp > 0) this.dropGem(e.x, e.y, info.xp, 'xp');
      if (info.boss) {
        s.bossKills += 1;
        this.dropGem(e.x + 8, e.y, HEAL_DROP_VALUE * 2, 'heal');
        if (e.kind === 'lord') {
          s.over = 'cleared';
        } else {
          // 중간 보스를 잡으면 무기 강화권을 한 장 받는다.
          s.pendingTickets += 1;
          this.events.push({ type: 'ticket' });
        }
      } else if (this.rand() < HEAL_DROP_CHANCE) {
        this.dropGem(e.x, e.y, HEAL_DROP_VALUE, 'heal');
      }
    }
    s.enemies.length = kept;
  }

  private dropGem(x: number, y: number, value: number, kind: Gem['kind']): void {
    const gems = this.state.gems;
    // 조각이 너무 많으면 가장 오래된 조각을 거두어 새 조각에 합친다. 값이 싸움터 가까이에 남는다.
    if (kind === 'xp' && gems.length >= GEM_LIMIT) {
      const oldest = gems.findIndex((gem) => gem.kind === 'xp' && !gem.pulled);
      if (oldest >= 0) {
        value += gems[oldest].value;
        gems.splice(oldest, 1);
      }
    }
    gems.push({ x, y, value, kind, pulled: false });
  }

  private moveGems(dt: number): void {
    const s = this.state;
    const p = s.player;
    const magnet = this.magnetRadius;
    let kept = 0;
    for (const gem of s.gems) {
      const dx = p.x - gem.x;
      const dy = p.y - gem.y;
      const distance = Math.hypot(dx, dy);
      if (!gem.pulled && distance < magnet) gem.pulled = true;
      if (gem.pulled) {
        if (distance < GEM_PICKUP) {
          this.collect(gem);
          continue;
        }
        const move = Math.min(distance, GEM_SPEED * dt);
        gem.x += (dx / distance) * move;
        gem.y += (dy / distance) * move;
      }
      s.gems[kept] = gem;
      kept += 1;
    }
    s.gems.length = kept;
  }

  private collect(gem: Gem): void {
    const s = this.state;
    const p = s.player;
    if (gem.kind === 'heal') {
      p.hp = Math.min(this.mods.maxHp, p.hp + gem.value);
      this.events.push({ type: 'heal' });
      return;
    }
    p.xp += gem.value * this.mods.xp;
    this.events.push({ type: 'gem' });
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level += 1;
      s.pendingLevelUps += 1;
      this.events.push({ type: 'levelup' });
    }
  }
}
