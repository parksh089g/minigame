import { afterEach, describe, expect, it } from 'vitest';
import { SCENE } from '../config';
import { homeLabel, homeScene, setHome } from './home';

describe('게임을 마치고 돌아갈 화면', () => {
  afterEach(() => setHome(null));

  it('보통은 허브로 돌아간다', () => {
    expect(homeScene()).toBe(SCENE.hub);
    expect(homeLabel('다른 게임 고르기')).toBe('다른 게임 고르기');
  });

  it('적어 둔 화면이 있으면 그리로 돌아가고, 지우면 다시 허브다', () => {
    setHome({ scene: 'SproutCompany', label: '회사로 돌아가기' });
    expect(homeScene()).toBe('SproutCompany');
    expect(homeLabel('다른 게임 고르기')).toBe('회사로 돌아가기');
    setHome(null);
    expect(homeScene()).toBe(SCENE.hub);
  });
});
