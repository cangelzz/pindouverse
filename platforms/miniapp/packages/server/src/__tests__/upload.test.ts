import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app } from '../app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '__fixtures__');

// Create a tiny valid PNG for testing
function createTestPng(): string {
  fs.mkdirSync(fixturesDir, { recursive: true });
  const filePath = path.join(fixturesDir, 'test.png');
  // Minimal 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(filePath, png);
  return filePath;
}

function createTestTxt(): string {
  fs.mkdirSync(fixturesDir, { recursive: true });
  const filePath = path.join(fixturesDir, 'test.txt');
  fs.writeFileSync(filePath, 'hello');
  return filePath;
}

describe('Upload routes', () => {
  it('POST /api/upload with image file returns URL', async () => {
    const filePath = createTestPng();
    const res = await request(app)
      .post('/api/upload')
      .attach('file', filePath);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toMatch(/^\/uploads\//);
  });

  it('POST /api/upload with no file returns error', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/upload with wrong file type returns error', async () => {
    const filePath = createTestTxt();
    const res = await request(app)
      .post('/api/upload')
      .attach('file', filePath);
    expect(res.status).toBe(500);
  });
});
