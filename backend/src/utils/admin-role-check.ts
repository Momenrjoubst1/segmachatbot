import { Request, Response, NextFunction } from 'express';

export function isAdminUser(userId: string | undefined): boolean {
  if (!userId) return false;
  const admins = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return admins.includes(userId);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminUser(req.user?.id)) {
    res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    return;
  }
  next();
}
