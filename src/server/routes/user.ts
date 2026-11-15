import { Router } from 'express';
import { z } from 'zod';
import {
  getConnectedAccount,
  getUserSettings,
  listAuditLogs,
  listBackgroundJobs,
  updateUserSettings,
  writeAuditLog,
} from '../../db/repositories.ts';
import { AuthRequest, requireAuth } from '../../middleware/auth.ts';
import { getMicrosoftRedirectUri, isMicrosoftConfigured } from '../services/microsoftGraph.ts';

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get('/me', async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const settings = await getUserSettings(user.id);
    const msAccount = await getConnectedAccount(user.id, 'microsoft');

    res.json({
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
      },
      settings,
      microsoft: {
        configured: isMicrosoftConfigured(),
        connected: Boolean(msAccount),
        accountEmail: msAccount?.accountEmail || null,
        accountName: msAccount?.accountName || null,
        redirectUri: getMicrosoftRedirectUri(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load profile' });
  }
});

const updateSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  defaultViewMode: z.enum(['grid', 'list', 'compact']).optional(),
  defaultOpenWith: z.record(z.string(), z.string()).optional(),
  dashboardLayout: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        visible: z.boolean(),
        size: z.enum(['sm', 'md', 'lg']),
        order: z.number(),
      })
    )
    .optional(),
});

userRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid settings payload', details: parsed.error.issues });
    }
    const updated = await updateUserSettings(req.dbUser!.id, parsed.data);
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: 'SETTINGS_UPDATED',
      targetType: 'account',
      targetId: req.dbUser!.uid,
      targetName: 'User Settings',
      status: 'success',
      details: { keys: Object.keys(parsed.data) },
      ipAddress: req.ip,
    });
    res.json({ settings: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save settings' });
  }
});

userRouter.get('/audit-logs', async (req: AuthRequest, res) => {
  try {
    const logs = await listAuditLogs(req.dbUser!.id, 60);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load audit logs' });
  }
});

userRouter.get('/jobs', async (req: AuthRequest, res) => {
  try {
    const jobs = await listBackgroundJobs(req.dbUser!.id);
    res.json({ jobs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load background jobs' });
  }
});
