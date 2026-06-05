import type { MiniProgram } from 'miniprogram-automator';
import { launchMiniProgram } from './helpers';

describe('PinDou miniapp - smoke', () => {
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

  it('opens the import tab as the entry page', async () => {
    const page = await mp.currentPage();
    expect(page.path).toBe('pages/import/index');
  });

  it('navigates to the projects tab via switchTab', async () => {
    const page = await mp.switchTab('/pages/projects/index');
    expect(page.path).toBe('pages/projects/index');
  });

  it('shows the empty-state hint when no projects are stored', async () => {
    await mp.callWxMethod('removeStorage', { key: 'pindou:projects' }).catch(() => undefined);
    const page = await mp.reLaunch('/pages/projects/index');
    await page.waitFor(300);
    const empty = await page.$('.projects__empty');
    expect(empty).not.toBeNull();
    if (empty) {
      const text = await empty.text();
      expect(text).toContain('还没有作品');
    }
  });
});
