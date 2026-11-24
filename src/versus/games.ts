/**
 * 친구와 함께할 수 있는 게임들의 규칙. 서버(worker/rooms.ts)와 한 폰으로 번갈아 하기(local-match.ts)가 같이 쓴다.
 * 새 게임을 넣으려면 그 게임의 TurnGame을 만들어 여기에 더하고, protocol.ts의 ROOM_GAMES에 id를 적는다.
 * Phaser나 브라우저에 기대는 파일을 불러오면 서버가 빌드되지 않는다.
 */
import { blackjackVersus } from '../games/blackjack/versus';
import { highLowVersus } from '../games/high-low/versus';
import { hulaVersus } from '../games/hula/versus';
import { oneCardVersus } from '../games/one-card/versus';
import { pokerVersus } from '../games/poker/versus';
import type { RoomGame } from './protocol';
import type { AnyTurnGame } from './room';

export const TURN_GAMES: Readonly<Record<RoomGame, AnyTurnGame>> = {
  hula: hulaVersus,
  'one-card': oneCardVersus,
  blackjack: blackjackVersus,
  'high-low': highLowVersus,
  poker: pokerVersus,
};
