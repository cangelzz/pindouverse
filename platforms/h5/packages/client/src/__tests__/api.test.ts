import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../utils/api';

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listProjects fetches /api/projects', async () => {
    const data = [{ id: '1' }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    const result = await api.listProjects();
    expect(fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(result).toEqual(data);
  });

  it('uploadImage calls /api/upload with FormData', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'test.png' }),
    });
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    const result = await api.uploadImage(file);
    expect(fetch).toHaveBeenCalledWith('/api/upload', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual({ url: 'test.png' });
  });

  it('saveProject sends correct body', async () => {
    const project = { name: 'test', data: {} };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1' }),
    });
    await api.saveProject(project);
    expect(fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(project),
    }));
  });
});
