/**
 * 게임을 그만두거나 끝냈을 때 돌아갈 화면. 보통은 허브다.
 * 허브가 아닌 화면(새싹 컴퍼니)에서 게임을 하러 보낼 때 그 화면을 적어 두면,
 * 결과 화면과 일시정지의 "그만하기"가 허브 대신 그리로 돌아간다. 허브가 열리면 지워진다.
 */
import { SCENE } from '../config';

export interface Home {
  /** 돌아갈 씬의 이름 */
  scene: string;
  /** 결과 화면에서 돌아가는 버튼에 적을 글 */
  label: string;
}

let home: Home | null = null;

/** 돌아갈 화면을 적어 둔다. null이면 허브로 돌아간다. */
export function setHome(next: Home | null): void {
  home = next;
}

/** 게임을 마치고 돌아갈 씬 */
export function homeScene(): string {
  return home?.scene ?? SCENE.hub;
}

/** 돌아가는 버튼에 적을 글. 허브로 돌아갈 때는 fallback을 쓴다. */
export function homeLabel(fallback: string): string {
  return home?.label ?? fallback;
}
