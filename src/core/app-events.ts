/** 앱 바깥 틀(뒤로 가기, 화면 방향)과 씬이 주고받는 약속. Phaser에 의존하지 않는다. */

/** game.events로 알리는 일 */
export const APP_EVENT = {
  /** 진행 중인 미니게임이 있으면 일시정지해 달라는 요청. 화면이 가로로 돌아갔을 때 보낸다. */
  pauseRequest: 'app-pause-request',
} as const;

/**
 * 뒤로 가기를 스스로 처리하는 씬이 갖추는 모양.
 * 이 메서드가 없는 씬에서는 허브로 돌아간다(core/back.ts).
 */
export interface BackAware {
  onBackRequest(): void;
}

/**
 * 화면 크기가 바뀌어 같은 씬을 다시 만들 때(core/refit.ts), 보던 것을 이어 보여 주려는 씬이 갖추는 모양.
 * 돌려준 값이 다시 만든 씬의 create(data)로 넘어간다. 이 메서드가 없으면 처음 연 것처럼 다시 만든다.
 */
export interface RefitAware {
  refitData(): object | undefined;
}

/** 씬이 RefitAware이면 다시 만들 때 넘길 값을 돌려준다. */
export function refitDataOf(scene: object): object | undefined {
  const candidate = scene as Partial<RefitAware>;
  return typeof candidate.refitData === 'function' ? candidate.refitData() : undefined;
}
