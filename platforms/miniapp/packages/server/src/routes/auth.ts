import { Router } from 'express';

const router = Router();

/**
 * POST /api/auth/wechat
 * Accept WeChat login code, exchange for session.
 * TODO: Replace mock with real WeChat API call:
 *   const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`;
 *   const { openid, session_key } = await fetch(url).then(r => r.json());
 *   // Look up or create user by openid, generate JWT, return user+token
 */
router.post('/wechat', (req, res) => {
  const { code } = req.body;
  // Mock response for development
  res.json({
    success: true,
    data: {
      user: { id: 'wx_mock_001', nickname: 'WeChat User', avatar: '' },
      token: 'mock_token_' + (code || 'guest'),
    },
  });
});

/** GET /api/auth/me — get current user */
router.get('/me', (req, res) => {
  const user = (req as any).user || { id: 'guest', nickname: 'Guest', avatar: '' };
  res.json({ success: true, data: { user } });
});

/** POST /api/auth/logout */
router.post('/logout', (_req, res) => {
  // TODO: Invalidate token/session
  res.json({ success: true });
});

export default router;
