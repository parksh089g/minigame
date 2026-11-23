import { describe, expect, it } from 'vitest';
import { hulaVersus, type HulaMatch } from '../games/hula/versus';
import { TURN_GAMES } from './games';
import { ROOM_GAMES, cleanRoomCode, formatRoomCode, roomCodeFrom, isSeatToken, seatTokenFrom } from './protocol';
import { askAgain, createRoom, joinRoom, leaveRoom, playMove, roomView } from './room';

const half = (): number => 0.25;

describe('방 코드와 열쇠', () => {
  it('방 코드는 여섯 글자이고, 사람이 친 것을 다듬는다', () => {
    const code = roomCodeFrom(new Uint8Array([0, 1, 2, 3, 4, 31]));
    expect(code).toBe('23456Z');
    expect(cleanRoomCode(' abc-def ')).toBe('ABCDEF');
    expect(cleanRoomCode('ABCDE')).toBeNull();
    expect(cleanRoomCode('ABCDE0')).toBeNull();
    expect(formatRoomCode('ABCDEF')).toBe('ABC-DEF');
  });

  it('자리 열쇠는 32자리 16진수다', () => {
    const token = seatTokenFrom(new Uint8Array(16).fill(171));
    expect(isSeatToken(token)).toBe(true);
    expect(isSeatToken(token.toUpperCase())).toBe(false);
  });

  it('친구와 할 수 있는 게임마다 규칙이 있다', () => {
    for (const game of ROOM_GAMES) expect(TURN_GAMES[game].id).toBe(game);
    expect(Object.keys(TURN_GAMES).sort()).toEqual([...ROOM_GAMES].sort());
  });
});

describe('방의 규칙', () => {
  it('친구가 들어오면 판이 시작되고, 판이 끝나면 이긴 판 수를 센다', () => {
    const room = createRoom<HulaMatch>('hula', '민수');
    expect(room.status).toBe('waiting');
    expect(roomView(room, hulaVersus, 0, 'ABCDEF').game).toBeNull();
    expect(joinRoom(room, hulaVersus, '지원', half)).toBe(true);
    expect(joinRoom(room, hulaVersus, '셋째', half)).toBe(false);
    expect(room.status).toBe('playing');
    expect(room.names).toEqual(['민수', '지원']);
    const first = hulaVersus.turnOf(room.round!)!;
    const before = room.version;
    expect(playMove(room, hulaVersus, first === 0 ? 1 : 0, { type: 'draw' })).toBe(false);
    expect(room.version).toBe(before);
    expect(playMove(room, hulaVersus, first, { type: 'draw' })).toBe(true);
    expect(room.version).toBe(before + 1);
  });

  it('둘 다 "한 판 더"를 눌러야 새 판이 시작되고, 먼저 두는 자리가 바뀐다', () => {
    const room = createRoom<HulaMatch>('hula', '민수');
    joinRoom(room, hulaVersus, '지원', half);
    const first = room.first;
    room.status = 'over';
    expect(askAgain(room, hulaVersus, 0, half)).toBe(true);
    expect(room.status).toBe('over');
    expect(room.again).toEqual([true, false]);
    askAgain(room, hulaVersus, 1, half);
    expect(room.status).toBe('playing');
    expect(room.again).toEqual([false, false]);
    expect(room.first).not.toBe(first);
    expect(hulaVersus.turnOf(room.round!)).toBe(room.first);
  });

  it('판을 하다 나가면 남은 사람이 이긴 것으로 치고 방이 닫힌다', () => {
    const room = createRoom<HulaMatch>('hula', '민수');
    joinRoom(room, hulaVersus, '지원', half);
    leaveRoom(room, 1);
    expect(room.status).toBe('closed');
    expect(room.left).toBe(1);
    expect(room.wins).toEqual([1, 0]);
    const version = room.version;
    leaveRoom(room, 0);
    expect(room.version).toBe(version);
    expect(playMove(room, hulaVersus, 0, { type: 'draw' })).toBe(false);
  });
});
