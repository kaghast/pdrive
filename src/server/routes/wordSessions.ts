import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  createEditingSession,
  getEditingSession,
  listEditingSessions,
  updateEditingSession,
  writeAuditLog,
} from '../../db/repositories.ts';
import { AuthRequest, requireAuth, requireGoogleToken } from '../../middleware/auth.ts';
import {
  computeMd5Hex,
  createDriveFileMultipart,
  downloadDriveFileBuffer,
  exportGoogleWorkspaceFile,
  getDriveFileMeta,
  updateDriveFileMedia,
} from '../services/driveApi.ts';
import {
  deleteOneDriveItemAndVerify,
  downloadOneDriveItemContent,
  getOneDriveItem,
  getValidMicrosoftToken,
  uploadTempFileToOneDrive,
} from '../services/microsoftGraph.ts';

export const wordSessionsRouter = Router();
wordSessionsRouter.use(requireAuth);

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

wordSessionsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const sessions = await listEditingSessions(req.dbUser!.id);
    // Mark expired active sessions as waiting_for_sync (NEVER auto-delete unsynchronized OneDrive files!)
    const now = Date.now();
    const reconciled = await Promise.all(
      sessions.map(async (s) => {
        if (s.status === 'editing' && s.expiresAt.getTime() < now) {
          return await updateEditingSession(s.id, { status: 'waiting_for_sync' });
        }
        return s;
      })
    );
    res.json({ sessions: reconciled });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load editing sessions' });
  }
});

wordSessionsRouter.post('/start', requireGoogleToken, async (req: AuthRequest, res) => {
  const schema = z.object({ fileId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'fileId is required' });
  }

  const userId = req.dbUser!.id;
  const sessionId = crypto.randomUUID();

  try {
    const msToken = await getValidMicrosoftToken(userId);
    const driveMeta = await getDriveFileMeta(req.googleAccessToken!, parsed.data.fileId);
    const isGoogleDoc = driveMeta.mimeType === GOOGLE_DOC_MIME;

    let fileBuffer: Buffer;
    let tempFileName = driveMeta.name;
    if (isGoogleDoc) {
      fileBuffer = await exportGoogleWorkspaceFile(req.googleAccessToken!, driveMeta.id, DOCX_MIME);
      if (!tempFileName.toLowerCase().endsWith('.docx')) {
        tempFileName = `${tempFileName}.docx`;
      }
    } else {
      fileBuffer = await downloadDriveFileBuffer(req.googleAccessToken!, driveMeta.id);
    }

    const safeTempName = `${sessionId.slice(0, 8)}-${tempFileName.replace(/[\\/]/g, '_')}`;
    const tempPath = `/PersonalDriveOS-Temp/${safeTempName}`;

    await createEditingSession({
      id: sessionId,
      userId,
      driveFileId: driveMeta.id,
      driveFileName: driveMeta.name,
      driveMimeType: driveMeta.mimeType,
      isGoogleDoc,
      originalDriveModifiedTime: driveMeta.modifiedTime || null,
      originalDriveMd5: driveMeta.md5Checksum || computeMd5Hex(fileBuffer),
      originalDriveSize: driveMeta.size || String(fileBuffer.length),
      onedriveTempPath: tempPath,
      status: 'creating',
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
    });

    const odItem = await uploadTempFileToOneDrive(msToken, tempPath, fileBuffer);

    const session = await updateEditingSession(sessionId, {
      onedriveItemId: odItem.id,
      onedriveWebUrl: odItem.webUrl,
      onedriveOriginalEtag: odItem.eTag || null,
      status: 'editing',
    });

    await writeAuditLog({
      userId,
      action: 'WORD_SESSION_STARTED',
      targetType: 'editing_session',
      targetId: sessionId,
      targetName: driveMeta.name,
      status: 'success',
      details: {
        driveFileId: driveMeta.id,
        onedriveItemId: odItem.id,
        isGoogleDoc,
      },
      ipAddress: req.ip,
    });

    res.json({ session, wordOnlineUrl: odItem.webUrl });
  } catch (error: any) {
    await updateEditingSession(sessionId, {
      status: 'sync_failed',
      lastError: error.message,
    }).catch(() => {});
    await writeAuditLog({
      userId,
      action: 'WORD_SESSION_START_FAILED',
      targetType: 'editing_session',
      targetId: sessionId,
      status: 'failure',
      details: { error: error.message },
      ipAddress: req.ip,
    });
    res.status(500).json({ error: error.message || 'Failed to start Word Online session' });
  }
});

wordSessionsRouter.post('/:id/finish', requireGoogleToken, async (req: AuthRequest, res) => {
  const sessionId = req.params.id;
  const userId = req.dbUser!.id;
  const schema = z.object({
    saveMode: z.enum(['overwrite_docx', 'new_docx', 'new_google_doc']).optional(),
    forceOverwrite: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid sync finish parameters' });
  }

  const session = await getEditingSession(userId, sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Editing session not found' });
  }
  if (!session.onedriveItemId) {
    return res.status(400).json({ error: 'Temporary OneDrive item ID is missing for this session.' });
  }

  try {
    await updateEditingSession(sessionId, {
      status: 'synchronizing',
      syncAttempts: session.syncAttempts + 1,
      lastError: null,
    });

    const msToken = await getValidMicrosoftToken(userId);
    const odItem = await getOneDriveItem(msToken, session.onedriveItemId);
    if (!odItem) {
      throw new Error('Temporary OneDrive file no longer exists. Cannot synchronize.');
    }

    const latestBuffer = await downloadOneDriveItemContent(msToken, session.onedriveItemId);
    if (latestBuffer.length === 0) {
      throw new Error('Downloaded OneDrive file is empty. Aborting sync to protect Google Drive data.');
    }
    const uploadedMd5 = computeMd5Hex(latestBuffer);

    const currentDriveMeta = await getDriveFileMeta(req.googleAccessToken!, session.driveFileId);

    // Conflict detection for binary .docx files: never silently overwrite a newer Drive version
    if (
      !session.isGoogleDoc &&
      parsed.data.saveMode !== 'new_docx' &&
      !parsed.data.forceOverwrite
    ) {
      const modifiedChanged =
        session.originalDriveModifiedTime &&
        currentDriveMeta.modifiedTime &&
        currentDriveMeta.modifiedTime !== session.originalDriveModifiedTime;
      const md5Changed =
        session.originalDriveMd5 &&
        currentDriveMeta.md5Checksum &&
        currentDriveMeta.md5Checksum !== session.originalDriveMd5;

      if (modifiedChanged || md5Changed) {
        const conflictSession = await updateEditingSession(sessionId, {
          status: 'conflict_detected',
          lastError:
            'Google Drive file was modified externally while Word Online editing was in progress.',
        });
        await writeAuditLog({
          userId,
          action: 'WORD_SYNC_CONFLICT',
          targetType: 'editing_session',
          targetId: sessionId,
          targetName: session.driveFileName,
          status: 'warning',
          details: {
            originalModified: session.originalDriveModifiedTime,
            currentDriveModified: currentDriveMeta.modifiedTime,
          },
          ipAddress: req.ip,
        });
        return res.status(409).json({
          error: 'Conflict detected: the Google Drive file was modified externally during editing.',
          session: conflictSession,
          currentDriveMeta,
        });
      }
    }

    let targetFileId = session.driveFileId;
    let savedDriveMeta;
    const parentId = currentDriveMeta.parents?.[0];

    if (session.isGoogleDoc || parsed.data.saveMode === 'new_docx' || parsed.data.saveMode === 'new_google_doc') {
      const baseName = session.driveFileName.replace(/\.docx$/i, '');
      if (parsed.data.saveMode === 'new_google_doc') {
        savedDriveMeta = await createDriveFileMultipart(req.googleAccessToken!, {
          name: `${baseName} (Edited)`,
          mimeType: GOOGLE_DOC_MIME,
          contentMimeType: DOCX_MIME,
          parentId,
          buffer: latestBuffer,
        });
      } else {
        savedDriveMeta = await createDriveFileMultipart(req.googleAccessToken!, {
          name: `${baseName} (Word Edited).docx`,
          mimeType: DOCX_MIME,
          parentId,
          buffer: latestBuffer,
        });
      }
      targetFileId = savedDriveMeta.id;
    } else {
      await updateDriveFileMedia(req.googleAccessToken!, session.driveFileId, latestBuffer, DOCX_MIME);
      savedDriveMeta = await getDriveFileMeta(req.googleAccessToken!, session.driveFileId);
    }

    // MANDATORY POST-UPLOAD VERIFICATION (do not trust HTTP 200 alone!)
    const verifiedMeta = await getDriveFileMeta(req.googleAccessToken!, targetFileId);
    const isGoogleWorkspaceDoc = verifiedMeta.mimeType.startsWith('application/vnd.google-apps.');

    if (!isGoogleWorkspaceDoc) {
      if (verifiedMeta.md5Checksum && verifiedMeta.md5Checksum !== uploadedMd5) {
        throw new Error(
          `Checksum mismatch after upload (expected ${uploadedMd5}, got ${verifiedMeta.md5Checksum}). OneDrive temporary copy preserved.`
        );
      }
      if (verifiedMeta.size && Number(verifiedMeta.size) !== latestBuffer.length) {
        throw new Error(
          `Size verification failed after upload (expected ${latestBuffer.length}, got ${verifiedMeta.size}). OneDrive temporary copy preserved.`
        );
      }
    } else if (!verifiedMeta.id || !verifiedMeta.modifiedTime) {
      throw new Error('Google Docs verification failed. OneDrive temporary copy preserved.');
    }

    // Step 11: Mark session as synchronized ONLY after verification
    await updateEditingSession(sessionId, {
      status: 'sync_verified',
      lastVerifiedSize: verifiedMeta.size || String(latestBuffer.length),
      lastVerifiedModifiedTime: verifiedMeta.modifiedTime || new Date().toISOString(),
    });

    await writeAuditLog({
      userId,
      action: 'WORD_SYNC_VERIFIED',
      targetType: 'drive_file',
      targetId: targetFileId,
      targetName: verifiedMeta.name,
      status: 'success',
      details: {
        sessionId,
        verifiedMd5: verifiedMeta.md5Checksum,
        verifiedSize: verifiedMeta.size,
      },
      ipAddress: req.ip,
    });

    // Step 12 & 13: Delete temporary OneDrive file ONLY after sync verification, and confirm deletion
    const deletedConfirmed = await deleteOneDriveItemAndVerify(msToken, session.onedriveItemId);
    if (!deletedConfirmed) {
      throw new Error('Google Drive sync verified, but OneDrive temporary file deletion could not be confirmed.');
    }

    await updateEditingSession(sessionId, { status: 'temp_deleted' });
    const completedSession = await updateEditingSession(sessionId, {
      status: 'completed',
      completedAt: new Date(),
    });

    await writeAuditLog({
      userId,
      action: 'ONEDRIVE_TEMP_DELETED',
      targetType: 'onedrive_temp',
      targetId: session.onedriveItemId,
      targetName: session.onedriveTempPath || session.driveFileName,
      status: 'success',
      details: { sessionId },
      ipAddress: req.ip,
    });

    res.json({
      session: completedSession,
      driveFile: verifiedMeta,
    });
  } catch (error: any) {
    // CRITICAL SAFETY RULE: NEVER delete OneDrive temp file when sync fails!
    const failedSession = await updateEditingSession(sessionId, {
      status: 'sync_failed',
      lastError: error.message,
    });
    await writeAuditLog({
      userId,
      action: 'WORD_SYNC_FAILED',
      targetType: 'editing_session',
      targetId: sessionId,
      targetName: session.driveFileName,
      status: 'failure',
      details: { error: error.message },
      ipAddress: req.ip,
    });
    res.status(500).json({
      error: error.message || 'Synchronization failed. Your OneDrive temporary copy has been preserved.',
      session: failedSession,
    });
  }
});

wordSessionsRouter.get('/:id/recover', async (req: AuthRequest, res) => {
  const session = await getEditingSession(req.dbUser!.id, req.params.id);
  if (!session || !session.onedriveItemId) {
    return res.status(404).json({ error: 'Recovery session or OneDrive item not found' });
  }
  try {
    const msToken = await getValidMicrosoftToken(req.dbUser!.id);
    const buffer = await downloadOneDriveItemContent(msToken, session.onedriveItemId);
    const fileName = session.driveFileName.endsWith('.docx')
      ? session.driveFileName
      : `${session.driveFileName}.docx`;

    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="RECOVERY-${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to download recovery file from OneDrive' });
  }
});

wordSessionsRouter.post('/:id/cleanup', async (req: AuthRequest, res) => {
  const session = await getEditingSession(req.dbUser!.id, req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  // Never delete unsynchronized temp files unless explicitly forced after user confirmation
  const isSafeToCleanup = ['sync_verified', 'temp_deleted', 'completed'].includes(session.status);
  if (!isSafeToCleanup && !req.body?.confirmDiscardUnsynced) {
    return res.status(400).json({
      error: 'Cannot clean up an unsynchronized temporary file without explicit discard confirmation.',
    });
  }

  try {
    if (session.onedriveItemId) {
      const msToken = await getValidMicrosoftToken(req.dbUser!.id);
      await deleteOneDriveItemAndVerify(msToken, session.onedriveItemId);
    }
    const updated = await updateEditingSession(session.id, {
      status: 'completed',
      completedAt: new Date(),
    });
    res.json({ session: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Cleanup failed' });
  }
});
