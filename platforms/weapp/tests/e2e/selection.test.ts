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

describe('PinDou miniapp - selection tool', () => {
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

  it('activates the select tool from the toolbar', async () => {
    const project = makeProject('p-sel', 'Selection Test', 20, 20);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    const allTools = await page.$$('.editor__tool');
    const allLabels = await page.$$('.editor__tool-label');
    expect(allLabels.length).toBe(allTools.length);
    let selectIdx = -1;
    for (let i = 0; i < allLabels.length; i++) {
      const text = await allLabels[i].text();
      if (text && text.includes('选区')) {
        selectIdx = i;
        break;
      }
    }
    expect(selectIdx).toBeGreaterThanOrEqual(0);

    await allTools[selectIdx].tap();
    await page.waitFor(200);
    const cls = await allTools[selectIdx].attribute('class');
    expect(cls).toMatch(/editor__tool--active/);
  }, 60_000);
});
