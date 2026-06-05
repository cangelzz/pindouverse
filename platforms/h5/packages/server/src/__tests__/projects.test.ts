import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('Projects CRUD', () => {
  let projectId: string;

  it('POST /api/projects creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Test Project', canvasData: { items: [] } });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe('Test Project');
    projectId = res.body.data.id;
  });

  it('GET /api/projects returns array including created project', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.some((p: any) => p.id === projectId)).toBe(true);
  });

  it('GET /api/projects/:id returns specific project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(projectId);
    expect(res.body.data.name).toBe('Test Project');
  });

  it('PUT /api/projects/:id updates project', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}`)
      .send({ name: 'Updated Project' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Project');
  });

  it('DELETE /api/projects/:id deletes project', async () => {
    const res = await request(app).delete(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/projects/:id after delete returns 404', async () => {
    const res = await request(app).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(404);
  });

  it('full CRUD lifecycle', async () => {
    // Create
    const c = await request(app).post('/api/projects').send({ name: 'Lifecycle' });
    expect(c.status).toBe(201);
    const id = c.body.data.id;

    // Read
    const r = await request(app).get(`/api/projects/${id}`);
    expect(r.body.data.name).toBe('Lifecycle');

    // Update
    const u = await request(app).put(`/api/projects/${id}`).send({ name: 'Updated' });
    expect(u.body.data.name).toBe('Updated');

    // Delete
    const d = await request(app).delete(`/api/projects/${id}`);
    expect(d.body.success).toBe(true);

    // Verify gone
    const g = await request(app).get(`/api/projects/${id}`);
    expect(g.status).toBe(404);
  });
});
