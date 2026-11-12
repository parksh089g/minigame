/**
 * 판을 열고 첫 조작을 기다리는 문.
 * 처음 하는 사람이 설명을 읽는 동안 제한 시간이 줄거나 판이 끝나 버리지 않게,
 * 첫 조작을 하거나 잠깐 기다릴 때까지 시계(또는 움직임)를 세워 둔다.
 * 시간을 들이지 않고 판을 오래 들여다볼 수는 없게, 기다리는 시간에는 끝이 있다.
 */

/** 아무것도 하지 않아도 이 시간(초)이 지나면 시작한다. 머지 타일, 길 잇기, 초성 퀴즈가 쓰는 값과 같다. */
export const AUTO_START_SECONDS = 4;

export class StartGate {
  private waited = 0;
  private opened = false;

  constructor(private readonly autoSeconds: number = AUTO_START_SECONDS) {}

  /** 시작했는지. false인 동안 게임은 시계를 돌리지 않는다. */
  get open(): boolean {
    return this.opened;
  }

  /** 첫 조작을 했을 때 부른다. 이번에 열렸으면 true, 이미 열려 있었으면 false. */
  start(): boolean {
    if (this.opened) return false;
    this.opened = true;
    return true;
  }

  /** 기다린 시간에 dt초를 더한다. 다 기다려서 이번에 열렸으면 true. */
  wait(dt: number): boolean {
    if (this.opened) return false;
    this.waited += dt;
    if (this.waited < this.autoSeconds) return false;
    this.opened = true;
    return true;
  }

  /** 새 판을 위해 다시 닫는다. */
  reset(): void {
    this.waited = 0;
    this.opened = false;
  }
}
