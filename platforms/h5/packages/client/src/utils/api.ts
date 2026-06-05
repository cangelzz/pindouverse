const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  // Auth
  login: (code: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ code }) }),

  // Projects
  listProjects: () => request<any[]>('/projects'),
  getProject: (id: string) => request<any>(`/projects/${id}`),
  saveProject: (data: any) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),

  // Upload
  uploadImage: async (file: File) => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
};
