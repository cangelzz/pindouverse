import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('Auth routes', () => {
  it('POST /api/auth/wechat returns user object', async () => {
    const res = await request(app)
      .post('/api/auth/wechat')
      .send({ code: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.id).toBe('wx_mock_001');
    expect(res.body.data.token).toContain('test123');
  });

  it('GET /api/auth/me returns guest user', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe('guest');
  });

  it('POST /api/auth/logout returns success', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
