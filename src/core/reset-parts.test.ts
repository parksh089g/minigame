import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDefaultMeta, metaStore } from '../games/lantern-keeper/meta';
import { STAFF_ORDER } from '../games/sprout-company/data';
import { createCompany } from '../games/sprout-company/rules';
import { companyStore } from '../games/sprout-company/store';
import { registerSavePart, resetParts } from './bundle';

describe('기록 초기화가 따로 저장하는 게임까지 지운다', () => {
  beforeAll(() => {
    // 테스트에서는 다른 곳과 주고받을 통로를 열지 않는다.
    vi.stubGlobal('BroadcastChannel', undefined);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('등록된 덩어리마다 null을 넘긴다', async () => {
    const written: unknown[] = [];
    registerSavePart('reset-test', {
      read: async () => 'x',
      write: async (raw) => {
        written.push(raw);
      },
    });
    await resetParts();
    expect(written).toEqual([null]);
  });

  it('등불지기와 새싹 컴퍼니가 처음 상태로 돌아간다', async () => {
    await metaStore.load();
    await companyStore.load();
    metaStore.set({ ...createDefaultMeta(), embers: 321, runs: 9 });
    companyStore.set(createCompany(STAFF_ORDER[0]));
    expect(companyStore.data).not.toBeNull();

    await resetParts();
    expect(metaStore.data).toEqual(createDefaultMeta());
    expect(metaStore.run).toBeNull();
    // 회사는 비워 두고, 다음에 열 때 새로 세운다.
    expect(companyStore.data).toBeNull();
  });
});
