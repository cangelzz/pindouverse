import { Request, Response, NextFunction } from 'express';

/**
 * Auth middleware - currently in guest mode (pass-through).
 * TODO: Implement JWT/session validation
 * - Verify token from Authorization header or cookie
 * - Attach user info to req (e.g. req.user)
 * - Return 401 if invalid
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Guest mode: attach a default guest user
  (req as any).user = { id: 'guest', nickname: 'Guest', avatar: '' };
  next();
}
