import { Router } from 'express';
import { z } from 'zod';
import { listFileMetadata, upsertFileMetadata, writeAuditLog } from '../../db/repositories.ts';
import { AuthRequest, requireAuth } from '../../middleware/auth.ts';

export const metadataRouter = Router();

metadataRouter.use(requireAuth);

metadataRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const items = await listFileMetadata(req.dbUser!.id);
    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load file metadata' });
  }
});

const fileRefSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  parentId: z.string().nullable().optional(),
  sizeBytes: z.string().nullable().optional(),
});

metadataRouter.post('/favorite', async (req: AuthRequest, res) => {
  try {
    const parsed = fileRefSchema.extend({ isFavorite: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid favorite payload' });
    }
    const item = await upsertFileMetadata(req.dbUser!.id, parsed.data);
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: parsed.data.isFavorite ? 'FILE_FAVORITED' : 'FILE_UNFAVORITED',
      targetType: 'drive_file',
      targetId: parsed.data.fileId,
      targetName: parsed.data.fileName,
      status: 'success',
      ipAddress: req.ip,
    });
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update favorite' });
  }
});

metadataRouter.post('/pin', async (req: AuthRequest, res) => {
  try {
    const parsed = fileRefSchema.extend({ isPinned: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid pin payload' });
    }
    const item = await upsertFileMetadata(req.dbUser!.id, parsed.data);
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update pin' });
  }
});

metadataRouter.post('/tags', async (req: AuthRequest, res) => {
  try {
    const parsed = fileRefSchema
      .extend({ tags: z.array(z.string().trim().min(1).max(32)).max(15) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid tags payload' });
    }
    const item = await upsertFileMetadata(req.dbUser!.id, parsed.data);
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: 'FILE_TAGS_UPDATED',
      targetType: 'drive_file',
      targetId: parsed.data.fileId,
      targetName: parsed.data.fileName,
      status: 'success',
      details: { tags: parsed.data.tags },
      ipAddress: req.ip,
    });
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update tags' });
  }
});

metadataRouter.post('/folder-style', async (req: AuthRequest, res) => {
  try {
    const parsed = fileRefSchema
      .extend({
        folderIcon: z.string().trim().max(40).nullable().optional(),
        folderColor: z.string().trim().max(24).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid folder style payload' });
    }
    const item = await upsertFileMetadata(req.dbUser!.id, parsed.data);
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: 'FOLDER_STYLE_UPDATED',
      targetType: 'drive_folder',
      targetId: parsed.data.fileId,
      targetName: parsed.data.fileName,
      status: 'success',
      details: {
        folderIcon: parsed.data.folderIcon ?? null,
        folderColor: parsed.data.folderColor ?? null,
      },
      ipAddress: req.ip,
    });
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update folder appearance' });
  }
});

metadataRouter.post('/recent', async (req: AuthRequest, res) => {
  try {
    const parsed = fileRefSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid recent file payload' });
    }
    const item = await upsertFileMetadata(req.dbUser!.id, {
      ...parsed.data,
      lastOpenedAt: new Date(),
    });
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to record recent file' });
  }
});

metadataRouter.post('/audit', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      action: z.string().min(1).max(64),
      targetType: z.string().min(1).max(32),
      targetId: z.string().optional(),
      targetName: z.string().optional(),
      status: z.enum(['success', 'failure', 'warning']),
      details: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid audit payload' });
    }
    await writeAuditLog({
      userId: req.dbUser!.id,
      ...parsed.data,
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to write audit log' });
  }
});
