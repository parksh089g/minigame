import { describe, expect, it } from 'vitest';
import { BUNDLE_APP, BUNDLE_VERSION, packBundle, unpackBundle } from './bundle';
import { createDefaultSave } from './save';

const NOW = 1_700_000_000_000;

describe('세이브 묶음', () => {
  it('묶은 것을 풀면 넣은 것이 그대로 나온다', () => {
    const save = createDefaultSave(NOW);
    const parts = { 'lantern-keeper': { meta: { embers: 12 }, run: null } };
    const bundle = packBundle(save, parts, NOW);
    expect(bundle).toMatchObject({ app: BUNDLE_APP, bundle: BUNDLE_VERSION, savedAt: NOW });
    expect(unpackBundle(JSON.parse(JSON.stringify(bundle)))).toEqual({ save, parts });
  });

  it('묶음이 생기기 전에 내보낸 세이브 파일도 받는다. 따로 저장된 것은 건드리지 않는다는 뜻으로 parts가 null이다', () => {
    const save = createDefaultSave(NOW);
    expect(unpackBundle(JSON.parse(JSON.stringify(save)))).toEqual({ save, parts: null });
  });

  it('덩어리가 빠진 묶음은 빈 덩어리로 읽는다', () => {
    const save = createDefaultSave(NOW);
    expect(unpackBundle({ app: BUNDLE_APP, bundle: 1, save })).toEqual({ save, parts: {} });
    expect(unpackBundle({ app: BUNDLE_APP, bundle: 1, save, parts: [1, 2] })).toEqual({ save, parts: {} });
  });

  it('이 앱의 것이 아니면 받지 않는다', () => {
    for (const raw of [null, 3, 'x', [], {}, { app: 'other', save: createDefaultSave(NOW) }]) {
      expect(unpackBundle(raw), JSON.stringify(raw)).toBeNull();
    }
    // 이름은 맞지만 세이브가 없거나 깨진 묶음
    expect(unpackBundle({ app: BUNDLE_APP, bundle: 1 })).toBeNull();
    expect(unpackBundle({ app: BUNDLE_APP, bundle: 1, save: { nope: true } })).toBeNull();
  });
});
