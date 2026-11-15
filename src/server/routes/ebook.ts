import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  createEbookAnnotation,
  deleteEbookAnnotation,
  getEbookReadingState,
  listEbookAnnotations,
  listEbookReadingStates,
  updateEbookAnnotation,
  upsertEbookReadingState,
  writeAuditLog,
} from '../../db/repositories.ts';
import { AuthRequest, requireAuth } from '../../middleware/auth.ts';

export const ebookRouter = Router();

ebookRouter.use(requireAuth);

const colorSchema = z.enum(['yellow', 'green', 'blue', 'pink']);
const formatSchema = z.enum(['epub', 'pdf']);

ebookRouter.get('/states', async (req: AuthRequest, res) => {
  try {
    const states = await listEbookReadingStates(req.dbUser!.id);
    res.json({ states });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load e-book reading states' });
  }
});

ebookRouter.get('/:fileId', async (req: AuthRequest, res) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId' });
    }
    const [state, annotations] = await Promise.all([
      getEbookReadingState(req.dbUser!.id, fileId),
      listEbookAnnotations(req.dbUser!.id, fileId),
    ]);
    res.json({ state, annotations });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load e-book data' });
  }
});

const progressSchema = z.object({
  fileName: z.string().min(1).max(512),
  format: formatSchema,
  currentLocation: z.string().min(1).max(256),
  currentPage: z.number().int().min(1).max(100000),
  totalPages: z.number().int().min(1).max(100000),
  scrollPercent: z.number().int().min(0).max(100),
  progressPercent: z.number().int().min(0).max(100),
  bookTitle: z.string().max(512).nullable().optional(),
  bookAuthor: z.string().max(512).nullable().optional(),
});

ebookRouter.put('/:fileId/progress', async (req: AuthRequest, res) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId' });
    }
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid progress payload' });
    }
    const state = await upsertEbookReadingState(req.dbUser!.id, {
      fileId,
      ...parsed.data,
    });
    res.json({ state });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save reading progress' });
  }
});

const createAnnotationSchema = z.object({
  fileName: z.string().min(1).max(512),
  format: formatSchema,
  pageNumber: z.number().int().min(1).max(100000),
  chapterTitle: z.string().max(512).nullable().optional(),
  quoteText: z.string().max(10000).default(''),
  noteText: z.string().max(10000).default(''),
  color: colorSchema.default('yellow'),
});

ebookRouter.post('/:fileId/annotations', async (req: AuthRequest, res) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId' });
    }
    const parsed = createAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid annotation payload' });
    }
    if (!parsed.data.quoteText.trim() && !parsed.data.noteText.trim()) {
      return res.status(400).json({ error: 'Provide either highlighted text or a note.' });
    }
    const annotation = await createEbookAnnotation(req.dbUser!.id, {
      id: randomUUID(),
      fileId,
      ...parsed.data,
    });
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: 'EBOOK_ANNOTATION_CREATED',
      targetType: 'drive_file',
      targetId: fileId,
      targetName: parsed.data.fileName,
      status: 'success',
      details: { pageNumber: parsed.data.pageNumber, color: parsed.data.color },
      ipAddress: req.ip,
    });
    res.status(201).json({ annotation });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create annotation' });
  }
});

const updateAnnotationSchema = z.object({
  noteText: z.string().max(10000).optional(),
  color: colorSchema.optional(),
  quoteText: z.string().max(10000).optional(),
  chapterTitle: z.string().max(512).nullable().optional(),
});

ebookRouter.patch('/:fileId/annotations/:id', async (req: AuthRequest, res) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    const id = String(req.params.id || '').trim();
    if (!fileId || !id) {
      return res.status(400).json({ error: 'Missing fileId or annotation id' });
    }
    const parsed = updateAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid annotation update payload' });
    }
    const annotation = await updateEbookAnnotation(req.dbUser!.id, fileId, id, parsed.data);
    if (!annotation) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    res.json({ annotation });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update annotation' });
  }
});

ebookRouter.delete('/:fileId/annotations/:id', async (req: AuthRequest, res) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    const id = String(req.params.id || '').trim();
    if (!fileId || !id) {
      return res.status(400).json({ error: 'Missing fileId or annotation id' });
    }
    const deleted = await deleteEbookAnnotation(req.dbUser!.id, fileId, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    res.json({ ok: true, id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete annotation' });
  }
});
