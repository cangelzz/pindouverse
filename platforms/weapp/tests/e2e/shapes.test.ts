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

describe('PinDou miniapp - shape tools', () => {
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

  it('opens the shape action sheet and activates the line tool', async () => {
    const project = makeProject('p-shape', 'Shape Tool Test', 26, 26);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    // Stub the action sheet to select 直线 (tapIndex 0)
    await mp.mockWxMethod('showActionSheet', { tapIndex: 0, errMsg: 'showActionSheet:ok' });

    // Locate the shape group button. Labels are rendered 1:1 with tool buttons
    // in the same source order, so the index of "形状" in the label list is
    // also the index of its parent .editor__tool node.
    const allTools = await page.$$('.editor__tool');
    const allLabels = await page.$$('.editor__tool-label');
    expect(allLabels.length).toBe(allTools.length);
    let shapeBtnIdx = -1;
    for (let i = 0; i < allLabels.length; i++) {
      const label = await allLabels[i].text();
      if (label && label.includes('形状')) {
        shapeBtnIdx = i;
        break;
      }
    }
    expect(shapeBtnIdx).toBeGreaterThanOrEqual(0);

    await allTools[shapeBtnIdx].tap();
    await page.waitFor(300);
    await mp.restoreWxMethod('showActionSheet');

    // After action sheet returned tapIndex 0, the shape button should be active
    const afterTools = await page.$$('.editor__tool');
    const shapeBtnAfter = afterTools[shapeBtnIdx];
    const classAttr = await shapeBtnAfter.attribute('class');
    expect(classAttr).toMatch(/editor__tool--active/);
  }, 60_000);
});
