import { describe, expect, it } from 'vitest';
import { LocalMatch } from '../../versus/match';
import { askAgain, createRoom, joinRoom, playMove, roomView } from '../../versus/room';
import { BLACK, pointAt, WHITE } from './rules';
import { omokTurn, omokVersus, readOmokMove, readOmokView, type OmokMatch } from './versus';

const half = (): number => 0.25;

describe('친구와 하는 오목', () => {
  it('먼저 두는 자리가 흑이고, 차례가 아닌 자리의 수는 받지 않는다', () => {
    const match = omokVersus.start(half, 1);
    expect(omokTurn(match)).toBe(1);
    expect(omokVersus.view(match, 1).mine).toBe(BLACK);
    expect(omokVersus.view(match, 0).mine).toBe(WHITE);
    expect(omokVersus.play(match, 0, { type: 'place', at: 0 })).toBe(false);
    expect(omokVersus.play(match, 1, { type: 'place', at: 112 })).toBe(true);
    expect(omokVersus.play(match, 0, { type: 'place', at: 112 })).toBe(false);
    expect(omokTurn(match)).toBe(0);
  });

  it('다섯을 이은 자리가 이기고, 이긴 뒤에는 더 둘 수 없다', () => {
    const match: OmokMatch = omokVersus.start(half, 0);
    for (let i = 0; i < 4; i += 1) {
      omokVersus.play(match, 0, { type: 'place', at: pointAt(i, 0) });
      omokVersus.play(match, 1, { type: 'place', at: pointAt(i, 5) });
    }
    expect(omokVersus.outcome(match)).toBeUndefined();
    expect(omokVersus.play(match, 0, { type: 'place', at: pointAt(4, 0) })).toBe(true);
    expect(omokVersus.outcome(match)).toEqual({ winner: 0 });
    expect(omokVersus.turnOf(match)).toBeNull();
    expect(omokVersus.play(match, 1, { type: 'place', at: pointAt(4, 5) })).toBe(false);
  });

  it('수와 판을 확인하며 읽는다', () => {
    expect(readOmokMove({ type: 'place', at: 3 })).toEqual({ type: 'place', at: 3 });
    expect(readOmokMove({ type: 'place', at: 225 })).toBeNull();
    expect(readOmokMove({ type: 'place', at: '3' })).toBeNull();
    expect(readOmokMove({ type: 'pass' })).toBeNull();
    expect(readOmokView({ moves: [1, 2], mine: 1 })).toEqual({ moves: [1, 2], mine: 1 });
    expect(readOmokView({ moves: [1, 1], mine: 1 })).toBeNull();
    expect(readOmokView({ moves: [1], mine: 3 })).toBeNull();
    expect(readOmokView(null)).toBeNull();
  });

  it('방에서 판이 끝나면 이긴 판을 세고, 한 판 더는 흑백을 바꾼다', () => {
    const room = createRoom<OmokMatch>('omok', '민수');
    joinRoom(room, omokVersus, '지원', half);
    const black = room.round!.black;
    const white = black === 0 ? 1 : 0;
    for (let i = 0; i < 4; i += 1) {
      expect(playMove(room, omokVersus, black, { type: 'place', at: pointAt(i, 0) })).toBe(true);
      expect(playMove(room, omokVersus, white, { type: 'place', at: pointAt(i, 5) })).toBe(true);
    }
    playMove(room, omokVersus, black, { type: 'place', at: pointAt(4, 0) });
    expect(room.status).toBe('over');
    expect(room.wins[black]).toBe(1);
    const sent = JSON.parse(JSON.stringify(roomView(room, omokVersus, white, 'ABCDEF')));
    expect(readOmokView(sent.game)?.moves).toHaveLength(9);
    askAgain(room, omokVersus, 0, half);
    askAgain(room, omokVersus, 1, half);
    expect(room.status).toBe('playing');
    expect(room.round!.black).toBe(white);
    expect(room.round!.moves).toEqual([]);
  });

  it('한 폰으로 할 때는 둘 차례인 사람의 돌로 보여 준다', async () => {
    const match = new LocalMatch(omokVersus, ['1P', '2P'], half);
    expect(match.myTurn()).toBe(true);
    expect(match.room.game?.mine).toBe(BLACK);
    expect(await match.send({ type: 'place', at: 112 })).toBe(true);
    expect(match.room.game?.mine).toBe(WHITE);
    expect(match.room.game?.moves).toEqual([112]);
    expect(await match.send({ type: 'place', at: 112 })).toBe(false);
  });
});
