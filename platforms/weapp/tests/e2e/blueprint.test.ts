import type { MiniProgram } from 'miniprogram-automator';
import { launchMiniProgram } from './helpers';

interface MockProject {
  id: string;
  name: string;
  data: Array<Array<{ colorIndex: number | null }>>;
  width: number;
  height: number;
  algorithm: string;
  createdAt: number;
}

function makeProject(id: string, name: string, w: number, h: number): MockProject {
  const row = Array.from({ length: w }, () => ({ colorIndex: 0 }));
  const data = Array.from({ length: h }, () => row.map((c) => ({ ...c })));
  return {
    id,
    name,
    data,
    width: w,
    height: h,
    algorithm: 'cielab',
    createdAt: Date.now(),
  };
}

describe('PinDou miniapp - blueprint mode', () => {
  let mp: MiniProgram;

  beforeAll(async () => {
    mp = await launchMiniProgram();
  }, 90_000);

  afterAll(async () => {
    if (mp) {
      try {
        await mp.close();
      } catch {
        /* noop */
      }
    }
  });

  it('toggles blueprint mode via project menu and persists to storage', async () => {
    await mp.callWxMethod('removeStorage', { key: 'pindou:blueprint:mode' });
    await mp.callWxMethod('removeStorage', { key: 'pindou:blueprint:mirror' });

    const project = makeProject('p-bp', 'Blueprint Test', 20, 20);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    // Locate the menu button (⋯) in the editor header.
    const headerButtons = await page.$$('.editor__icon-btn');
    let menuIdx = -1;
    for (let i = 0; i < headerButtons.length; i++) {
      const text = await headerButtons[i].text();
      if (text && text.includes('⋯')) {
        menuIdx = i;
        break;
      }
    }
    expect(menuIdx).toBeGreaterThanOrEqual(0);

    // Static stub: "进入图纸模式" sits at index 6 in the default 11-item menu
    // when blueprint is OFF (the conditional mirror entry is absent).
    await mp.mockWxMethod('showActionSheet', { tapIndex: 6, errMsg: 'showActionSheet:ok' });

    await headerButtons[menuIdx].tap();
    await page.waitFor(300);
    await mp.restoreWxMethod('showActionSheet');

    const after = await mp.callWxMethod<{ data: boolean }>('getStorage', {
      key: 'pindou:blueprint:mode',
    });
    expect(after?.data).toBe(true);
  }, 60_000);
});
