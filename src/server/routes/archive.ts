import type { Archiver } from 'archiver';
import { execFile } from 'child_process';
import crypto from 'crypto';
import { createRequire } from 'module';
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import unzipper from 'unzipper';
import { promisify } from 'util';
import { z } from 'zod';
import {
  createBackgroundJob,
  updateBackgroundJob,
  writeAuditLog,
} from '../../db/repositories.ts';
import { AuthRequest, requireAuth, requireGoogleToken } from '../../middleware/auth.ts';
import {
  createDriveFileMultipart,
  createDriveFolder,
  downloadDriveFileBuffer,
  exportGoogleWorkspaceFile,
  getDriveFileMeta,
  listDriveFolderChildren,
} from '../services/driveApi.ts';

const execFileAsync = promisify(execFile);

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_EXTRACTED_BYTES = 400 * 1024 * 1024; // 400 MB
const MAX_ARCHIVE_ENTRIES = 1500;
const MAX_COMPRESSION_RATIO = 100;

export const archiveRouter = Router();
archiveRouter.use(requireAuth);

function sanitizeZipEntryPath(entryPath: string): string {
  const normalized = path.posix.normalize(entryPath.replace(/\\/g, '/'));
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('..') ||
    normalized.includes('/../') ||
    normalized === '..'
  ) {
    throw new Error(`Blocked unsafe archive entry path: ${entryPath}`);
  }
  return normalized.replace(/^\/+/, '');
}

const GOOGLE_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
  },
};

async function has7zBinary(): Promise<boolean> {
  try {
    await execFileAsync('which', ['7z']);
    return true;
  } catch {
    return false;
  }
}

archiveRouter.get('/capabilities', async (_req, res) => {
  const rarSupported = await has7zBinary();
  res.json({
    zip: true,
    rar: rarSupported,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    maxEntries: MAX_ARCHIVE_ENTRIES,
  });
});

archiveRouter.post('/inspect', requireGoogleToken, async (req: AuthRequest, res) => {
  const schema = z.object({ fileId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'fileId is required' });
  }

  try {
    const meta = await getDriveFileMeta(req.googleAccessToken!, parsed.data.fileId);
    const sizeNum = Number(meta.size || 0);
    if (sizeNum > MAX_ARCHIVE_BYTES) {
      return res.status(413).json({
        error: `Archive exceeds safety limit of ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB`,
      });
    }

    const buffer = await downloadDriveFileBuffer(req.googleAccessToken!, parsed.data.fileId);
    const directory = await unzipper.Open.buffer(buffer);

    if (directory.files.length > MAX_ARCHIVE_ENTRIES) {
      return res.status(400).json({
        error: `Archive contains ${directory.files.length} entries, exceeding the ${MAX_ARCHIVE_ENTRIES} entry safety limit.`,
      });
    }

    let totalUncompressed = 0;
    let totalCompressed = 0;
    const entries = directory.files.map((f) => {
      const safePath = sanitizeZipEntryPath(f.path);
      totalUncompressed += f.uncompressedSize || 0;
      totalCompressed += f.compressedSize || 0;
      return {
        path: safePath,
        type: f.type === 'Directory' ? 'directory' : 'file',
        uncompressedSize: f.uncompressedSize || 0,
        compressedSize: f.compressedSize || 0,
        lastModified: f.lastModifiedDateTime || null,
      };
    });

    const ratio = totalCompressed > 0 ? totalUncompressed / totalCompressed : 1;
    const zipBombWarning =
      totalUncompressed > MAX_EXTRACTED_BYTES || ratio > MAX_COMPRESSION_RATIO;

    res.json({
      file: meta,
      entries,
      summary: {
        entryCount: entries.length,
        totalUncompressed,
        totalCompressed,
        compressionRatio: Number(ratio.toFixed(2)),
        zipBombWarning,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to inspect archive' });
  }
});

archiveRouter.post('/extract', requireGoogleToken, async (req: AuthRequest, res) => {
  const schema = z.object({
    fileId: z.string().min(1),
    destinationFolderId: z.string().min(1),
    selectedPaths: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid extract request' });
  }

  const jobId = crypto.randomUUID();
  const userId = req.dbUser!.id;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'driveos-extract-'));

  try {
    const archiveMeta = await getDriveFileMeta(req.googleAccessToken!, parsed.data.fileId);
    await createBackgroundJob({
      id: jobId,
      userId,
      jobType: 'zip_extract',
      status: 'running',
      progress: 10,
      summary: `Extracting ${archiveMeta.name}`,
    });

    const buffer = await downloadDriveFileBuffer(req.googleAccessToken!, parsed.data.fileId);
    const directory = await unzipper.Open.buffer(buffer);

    if (directory.files.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Archive exceeds maximum ${MAX_ARCHIVE_ENTRIES} entries limit.`);
    }

    const filterSet =
      parsed.data.selectedPaths && parsed.data.selectedPaths.length > 0
        ? new Set(parsed.data.selectedPaths.map((p) => sanitizeZipEntryPath(p)))
        : null;

    let runningUncompressed = 0;
    const folderCache = new Map<string, string>();
    folderCache.set('', parsed.data.destinationFolderId);

    const ensureDriveFolderPath = async (relDir: string): Promise<string> => {
      if (!relDir || relDir === '.') return parsed.data.destinationFolderId;
      if (folderCache.has(relDir)) return folderCache.get(relDir)!;

      const parentDir = path.posix.dirname(relDir);
      const folderName = path.posix.basename(relDir);
      const parentDriveId = await ensureDriveFolderPath(parentDir === '.' ? '' : parentDir);
      const created = await createDriveFolder(req.googleAccessToken!, folderName, parentDriveId);
      folderCache.set(relDir, created.id);
      return created.id;
    };

    const filesToExtract = directory.files.filter((entry) => {
      if (entry.type === 'Directory') return false;
      const safe = sanitizeZipEntryPath(entry.path);
      if (safe.includes('__MACOSX/')) return false;
      if (!filterSet) return true;
      return filterSet.has(safe);
    });

    let uploadedCount = 0;
    for (const entry of filesToExtract) {
      const safePath = sanitizeZipEntryPath(entry.path);
      const resolvedLocal = path.resolve(tmpDir, safePath);
      if (!resolvedLocal.startsWith(path.resolve(tmpDir) + path.sep)) {
        throw new Error(`Path traversal attempt blocked: ${entry.path}`);
      }

      const content = await entry.buffer();
      runningUncompressed += content.length;
      if (runningUncompressed > MAX_EXTRACTED_BYTES) {
        throw new Error('Extraction aborted: uncompressed size exceeded safety quota (ZIP bomb guard).');
      }

      const dirPart = path.posix.dirname(safePath);
      const fileName = path.posix.basename(safePath);
      const targetParentId = await ensureDriveFolderPath(dirPart === '.' ? '' : dirPart);

      await createDriveFileMultipart(req.googleAccessToken!, {
        name: fileName,
        mimeType: 'application/octet-stream',
        parentId: targetParentId,
        buffer: content,
      });

      uploadedCount++;
      const progress = Math.min(95, 15 + Math.round((uploadedCount / Math.max(1, filesToExtract.length)) * 80));
      await updateBackgroundJob(jobId, { progress });
    }

    await updateBackgroundJob(jobId, {
      status: 'completed',
      progress: 100,
      resultMeta: { uploadedCount, destinationFolderId: parsed.data.destinationFolderId },
    });

    await writeAuditLog({
      userId,
      action: 'ZIP_EXTRACTED',
      targetType: 'archive',
      targetId: archiveMeta.id,
      targetName: archiveMeta.name,
      status: 'success',
      details: { uploadedCount, destinationFolderId: parsed.data.destinationFolderId },
      ipAddress: req.ip,
    });

    res.json({ jobId, uploadedCount, status: 'completed' });
  } catch (error: any) {
    await updateBackgroundJob(jobId, { status: 'failed', error: error.message });
    await writeAuditLog({
      userId,
      action: 'ZIP_EXTRACT_FAILED',
      targetType: 'archive',
      targetId: parsed.data.fileId,
      status: 'failure',
      details: { error: error.message },
      ipAddress: req.ip,
    });
    res.status(500).json({ error: error.message || 'Archive extraction failed' });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

archiveRouter.post('/create', requireGoogleToken, async (req: AuthRequest, res) => {
  const schema = z.object({
    fileIds: z.array(z.string().min(1)).min(1),
    archiveName: z.string().min(1).max(160),
    destinationFolderId: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid archive create payload' });
  }

  const jobId = crypto.randomUUID();
  const userId = req.dbUser!.id;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'driveos-zip-'));
  const finalName = parsed.data.archiveName.endsWith('.zip')
    ? parsed.data.archiveName
    : `${parsed.data.archiveName}.zip`;
  const zipFilePath = path.join(tmpDir, finalName);

  try {
    await createBackgroundJob({
      id: jobId,
      userId,
      jobType: 'zip_create',
      status: 'running',
      progress: 10,
      summary: `Creating ${finalName}`,
    });

    const require = createRequire(import.meta.url);
    const archiverFn = require('archiver') as (
      format: 'zip',
      options?: { zlib?: { level?: number } }
    ) => Archiver;
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiverFn('zip', { zlib: { level: 6 } });
    const finalizePromise = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));
    });
    archive.pipe(output);

    let fileCount = 0;
    let totalBytes = 0;

    const appendDriveItem = async (fileId: string, prefixPath: string, depth = 0) => {
      if (depth > 15) throw new Error('Maximum folder nesting depth exceeded');
      if (fileCount >= MAX_ARCHIVE_ENTRIES) {
        throw new Error(`Maximum ${MAX_ARCHIVE_ENTRIES} files per archive exceeded`);
      }

      const meta = await getDriveFileMeta(req.googleAccessToken!, fileId);
      const safeName = meta.name.replace(/[\\/]/g, '_');

      if (meta.mimeType === 'application/vnd.google-apps.folder') {
        const folderPath = prefixPath ? `${prefixPath}/${safeName}` : safeName;
        archive.append('', { name: `${folderPath}/` });
        const children = await listDriveFolderChildren(req.googleAccessToken!, meta.id);
        for (const child of children) {
          await appendDriveItem(child.id, folderPath, depth + 1);
        }
        return;
      }

      let buf: Buffer;
      let entryName = prefixPath ? `${prefixPath}/${safeName}` : safeName;
      if (GOOGLE_EXPORT_MAP[meta.mimeType]) {
        const exp = GOOGLE_EXPORT_MAP[meta.mimeType];
        buf = await exportGoogleWorkspaceFile(req.googleAccessToken!, meta.id, exp.mime);
        if (!entryName.endsWith(exp.ext)) entryName += exp.ext;
      } else if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
        // Export other Workspace docs as PDF
        buf = await exportGoogleWorkspaceFile(req.googleAccessToken!, meta.id, 'application/pdf');
        if (!entryName.endsWith('.pdf')) entryName += '.pdf';
      } else {
        buf = await downloadDriveFileBuffer(req.googleAccessToken!, meta.id);
      }

      totalBytes += buf.length;
      if (totalBytes > MAX_EXTRACTED_BYTES) {
        throw new Error('Archive source data exceeded maximum 400 MB safety limit');
      }

      archive.append(buf, { name: entryName });
      fileCount++;
    };

    for (const id of parsed.data.fileIds) {
      await appendDriveItem(id, '');
    }

    await updateBackgroundJob(jobId, { progress: 70 });
    await archive.finalize();
    await finalizePromise;

    const zipBuffer = await fs.promises.readFile(zipFilePath);
    await updateBackgroundJob(jobId, { progress: 85 });

    const uploaded = await createDriveFileMultipart(req.googleAccessToken!, {
      name: finalName,
      mimeType: 'application/zip',
      parentId: parsed.data.destinationFolderId,
      buffer: zipBuffer,
    });

    await updateBackgroundJob(jobId, {
      status: 'completed',
      progress: 100,
      resultMeta: { uploadedFileId: uploaded.id, fileCount, size: zipBuffer.length },
    });

    await writeAuditLog({
      userId,
      action: 'ZIP_CREATED',
      targetType: 'archive',
      targetId: uploaded.id,
      targetName: finalName,
      status: 'success',
      details: { fileCount, size: zipBuffer.length },
      ipAddress: req.ip,
    });

    res.json({ jobId, file: uploaded, fileCount, size: zipBuffer.length });
  } catch (error: any) {
    await updateBackgroundJob(jobId, { status: 'failed', error: error.message });
    await writeAuditLog({
      userId,
      action: 'ZIP_CREATE_FAILED',
      targetType: 'archive',
      targetName: finalName,
      status: 'failure',
      details: { error: error.message },
      ipAddress: req.ip,
    });
    res.status(500).json({ error: error.message || 'Failed to create ZIP archive' });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
