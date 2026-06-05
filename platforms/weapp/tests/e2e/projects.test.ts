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

describe('PinDou miniapp - projects flow', () => {
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

  it('lists seeded projects and navigates to the result page on tap', async () => {
    const projects: MockProject[] = [
      makeProject('p-1', '测试作品 A', 26, 26),
      makeProject('p-2', '测试作品 B', 52, 52),
    ];
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: projects });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);

    const items = await list.$$('.projects__item');
    expect(items.length).toBe(projects.length);

    const firstName = await (await list.$('.projects__item-name'))?.text();
    // List is sorted desc by createdAt — both share Date.now() so order is
    // insertion-stable; the latter (p-2) sorts before p-1 if createdAt differs,
    // otherwise the input order wins. Assert membership instead of order.
    expect(['测试作品 A', '测试作品 B']).toContain(firstName);

    await items[0].tap();
    await mp.evaluate(() => {
      // give navigation a tick
      return new Promise((r) => setTimeout(r, 400));
    });

    const result = await mp.currentPage();
    expect(result.path).toBe('pages/result/index');
  }, 60_000);

  it('removes a project after confirming deletion', async () => {
    const projects: MockProject[] = [makeProject('p-del', '要删除的作品', 26, 26)];
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: projects });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);

    // Stub wx.showModal to auto-confirm.
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false });

    const deleteBtn = await list.$('.projects__item-delete');
    expect(deleteBtn).not.toBeNull();
    await deleteBtn!.tap();
    await list.waitFor(400);

    await mp.restoreWxMethod('showModal');

    const after = await mp.callWxMethod<{ data: MockProject[] }>('getStorage', {
      key: 'pindou:projects',
    });
    const remaining = Array.isArray(after?.data) ? after.data : [];
    expect(remaining.find((p) => p.id === 'p-del')).toBeUndefined();
  }, 60_000);
});
