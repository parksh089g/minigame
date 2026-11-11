/**
 * 최고 점수와 닉네임을 서버에 올리는 일.
 * 닉네임을 정하기 전에는 아무것도 보내지 않는다. 인터넷이 없으면 그냥 실패하고, 다음 기회에 다시 보낸다
 * (무엇을 올렸는지는 세이브에 적혀 있어서, 올리지 못한 기록은 저절로 "보낼 것"으로 남는다).
 */
import type { SaveData } from '../core/save';
import type { ApiFailure, ApiResult } from './api';
import { pendingSubmit, withSent } from './profile';
import type { SubmitRequest, SubmitResult } from './protocol';

export type SyncOutcome =
  /** 랭킹에 참여하지 않아서 아무것도 보내지 않았다 */
  | { status: 'off' }
  /** 보낼 것이 없었다 */
  | { status: 'idle' }
  /** 올렸다. ranks는 이번에 올린 게임의 순위다. */
  | { status: 'sent'; ranks: Readonly<Record<string, number>> }
  | { status: 'failed'; reason: ApiFailure };

export interface SyncDeps {
  /** 지금의 세이브 */
  read(): SaveData;
  /** 세이브를 고치고 저장한다 */
  write(mutate: (save: SaveData) => void): void;
  submit(request: SubmitRequest): Promise<ApiResult<SubmitResult>>;
}

export class ScoreSync {
  private running: Promise<SyncOutcome> | null = null;
  /** 게임 id → 마지막으로 알게 된 내 순위. 화면에 바로 보여 주는 용도다. */
  private readonly ranks = new Map<string, number>();

  constructor(private readonly deps: SyncDeps) {}

  /** 보낼 것이 있으면 보낸다. 이미 보내는 중이면 그 결과를 같이 기다린다. */
  run(): Promise<SyncOutcome> {
    this.running ??= this.send().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** 마지막으로 알게 된 순위. 모르면 null. */
  rankOf(gameId: string): number | null {
    return this.ranks.get(gameId) ?? null;
  }

  /** 랭킹을 직접 불러와서 알게 된 순위를 적어 둔다. */
  noteRank(gameId: string, rank: number | null): void {
    if (rank === null) this.ranks.delete(gameId);
    else this.ranks.set(gameId, rank);
  }

  /** 닉네임을 지웠거나 다른 세이브를 불러왔을 때, 알고 있던 순위를 잊는다. */
  forgetRanks(): void {
    this.ranks.clear();
  }

  private async send(): Promise<SyncOutcome> {
    const before = this.deps.read();
    if (before.online.name === null) return { status: 'off' };
    const request = pendingSubmit(before.online, before.games);
    if (!request) return { status: 'idle' };

    const result = await this.deps.submit(request);
    if (!result.ok) return { status: 'failed', reason: result.reason };

    this.deps.write((save) => {
      save.online = withSent(save.online, request, result.data.bests);
    });
    if (this.deps.read().online.id === request.device) {
      for (const [game, rank] of Object.entries(result.data.ranks)) this.ranks.set(game, rank);
    }
    return { status: 'sent', ranks: result.data.ranks };
  }
}
