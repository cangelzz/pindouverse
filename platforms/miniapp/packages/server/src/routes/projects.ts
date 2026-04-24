import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// TODO: Replace with database (e.g. SQLite/PostgreSQL)
interface Project {
  id: string;
  userId: string;
  name: string;
  canvasData: any;
  createdAt: string;
  updatedAt: string;
}

const projects = new Map<string, Project>();

/** GET /api/projects — list user's projects */
router.get('/', (req, res) => {
  const userId = (req as any).user?.id || 'guest';
  const list = [...projects.values()].filter((p) => p.userId === userId);
  res.json({ success: true, data: list });
});

/** POST /api/projects — create project */
router.post('/', (req, res) => {
  const userId = (req as any).user?.id || 'guest';
  const { name, canvasData } = req.body;
  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv4(),
    userId,
    name: name || 'Untitled',
    canvasData: canvasData || {},
    createdAt: now,
    updatedAt: now,
  };
  projects.set(project.id, project);
  res.status(201).json({ success: true, data: project });
});

/** GET /api/projects/:id */
router.get('/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: project });
});

/** PUT /api/projects/:id */
router.put('/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ success: false, error: 'Not found' });
  const { name, canvasData } = req.body;
  if (name !== undefined) project.name = name;
  if (canvasData !== undefined) project.canvasData = canvasData;
  project.updatedAt = new Date().toISOString();
  res.json({ success: true, data: project });
});

/** DELETE /api/projects/:id */
router.delete('/:id', (req, res) => {
  if (!projects.delete(req.params.id)) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.json({ success: true });
});

export default router;
