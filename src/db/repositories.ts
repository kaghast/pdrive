import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  backgroundJobs,
  connectedAccounts,
  DashboardCardConfig,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_OPEN_WITH,
  editingSessions,
  fileMetadata,
  OpenWithPreferences,
  users,
  userSettings,
} from './schema.ts';

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
}) {
  try {
    const [user] = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        displayName: params.displayName ?? null,
        photoUrl: params.photoUrl ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          displayName: params.displayName ?? null,
          photoUrl: params.photoUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await db
      .insert(userSettings)
      .values({
        userId: user.id,
        theme: 'light',
        defaultViewMode: 'grid',
        defaultOpenWith: DEFAULT_OPEN_WITH,
        dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
      })
      .onConflictDoNothing({ target: userSettings.userId });

    return user;
  } catch (error) {
    console.error('getOrCreateUser failed:', error);
    throw new Error('Failed to synchronize user profile.', { cause: error });
  }
}

export async function getUserSettings(userId: number) {
  try {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    if (!settings) {
      const [created] = await db
        .insert(userSettings)
        .values({
          userId,
          theme: 'light',
          defaultViewMode: 'grid',
          defaultOpenWith: DEFAULT_OPEN_WITH,
          dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
        })
        .returning();
      return created;
    }
    return settings;
  } catch (error) {
    console.error('getUserSettings failed:', error);
    throw new Error('Failed to load user settings.', { cause: error });
  }
}

export async function updateUserSettings(
  userId: number,
  patch: {
    theme?: string;
    defaultViewMode?: string;
    defaultOpenWith?: OpenWithPreferences;
    dashboardLayout?: DashboardCardConfig[];
  }
) {
  try {
    const [updated] = await db
      .update(userSettings)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId))
      .returning();
    return updated;
  } catch (error) {
    console.error('updateUserSettings failed:', error);
    throw new Error('Failed to update user settings.', { cause: error });
  }
}

export async function listFileMetadata(userId: number) {
  try {
    return await db
      .select()
      .from(fileMetadata)
      .where(eq(fileMetadata.userId, userId))
      .orderBy(desc(fileMetadata.updatedAt));
  } catch (error) {
    console.error('listFileMetadata failed:', error);
    throw new Error('Failed to load file metadata.', { cause: error });
  }
}

export async function upsertFileMetadata(
  userId: number,
  input: {
    provider?: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    parentId?: string | null;
    sizeBytes?: string | null;
    isFavorite?: boolean;
    isPinned?: boolean;
    tags?: string[];
    lastOpenedAt?: Date;
  }
) {
  try {
    const provider = input.provider ?? 'google-drive';
    const [existing] = await db
      .select()
      .from(fileMetadata)
      .where(
        and(
          eq(fileMetadata.userId, userId),
          eq(fileMetadata.provider, provider),
          eq(fileMetadata.fileId, input.fileId)
        )
      );

    if (!existing) {
      const [inserted] = await db
        .insert(fileMetadata)
        .values({
          userId,
          provider,
          fileId: input.fileId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          parentId: input.parentId ?? null,
          sizeBytes: input.sizeBytes ?? null,
          isFavorite: input.isFavorite ?? false,
          isPinned: input.isPinned ?? false,
          tags: input.tags ?? [],
          lastOpenedAt: input.lastOpenedAt ?? null,
          updatedAt: new Date(),
        })
        .returning();
      return inserted;
    }

    const [updated] = await db
      .update(fileMetadata)
      .set({
        fileName: input.fileName,
        mimeType: input.mimeType,
        parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
        sizeBytes: input.sizeBytes !== undefined ? input.sizeBytes : existing.sizeBytes,
        isFavorite: input.isFavorite !== undefined ? input.isFavorite : existing.isFavorite,
        isPinned: input.isPinned !== undefined ? input.isPinned : existing.isPinned,
        tags: input.tags !== undefined ? input.tags : existing.tags,
        lastOpenedAt: input.lastOpenedAt !== undefined ? input.lastOpenedAt : existing.lastOpenedAt,
        updatedAt: new Date(),
      })
      .where(eq(fileMetadata.id, existing.id))
      .returning();
    return updated;
  } catch (error) {
    console.error('upsertFileMetadata failed:', error);
    throw new Error('Failed to save file metadata.', { cause: error });
  }
}

export async function getConnectedAccount(userId: number, provider: string) {
  try {
    const [acct] = await db
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, provider)));
    return acct ?? null;
  } catch (error) {
    console.error('getConnectedAccount failed:', error);
    throw new Error('Failed to read connected account.', { cause: error });
  }
}

export async function upsertConnectedAccount(input: {
  userId: number;
  provider: string;
  accountEmail?: string | null;
  accountName?: string | null;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  expiresAt?: Date | null;
  scopes?: string | null;
}) {
  try {
    const [acct] = await db
      .insert(connectedAccounts)
      .values({
        ...input,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [connectedAccounts.userId, connectedAccounts.provider],
        set: {
          accountEmail: input.accountEmail ?? null,
          accountName: input.accountName ?? null,
          accessTokenEnc: input.accessTokenEnc,
          refreshTokenEnc: input.refreshTokenEnc ?? null,
          expiresAt: input.expiresAt ?? null,
          scopes: input.scopes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return acct;
  } catch (error) {
    console.error('upsertConnectedAccount failed:', error);
    throw new Error('Failed to store connected account.', { cause: error });
  }
}

export async function deleteConnectedAccount(userId: number, provider: string) {
  try {
    await db
      .delete(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, provider)));
  } catch (error) {
    console.error('deleteConnectedAccount failed:', error);
    throw new Error('Failed to disconnect account.', { cause: error });
  }
}

export async function listEditingSessions(userId: number) {
  try {
    return await db
      .select()
      .from(editingSessions)
      .where(eq(editingSessions.userId, userId))
      .orderBy(desc(editingSessions.createdAt));
  } catch (error) {
    console.error('listEditingSessions failed:', error);
    throw new Error('Failed to list editing sessions.', { cause: error });
  }
}

export async function getEditingSession(userId: number, sessionId: string) {
  try {
    const [session] = await db
      .select()
      .from(editingSessions)
      .where(and(eq(editingSessions.id, sessionId), eq(editingSessions.userId, userId)));
    return session ?? null;
  } catch (error) {
    console.error('getEditingSession failed:', error);
    throw new Error('Failed to load editing session.', { cause: error });
  }
}

export async function createEditingSession(input: typeof editingSessions.$inferInsert) {
  try {
    const [created] = await db.insert(editingSessions).values(input).returning();
    return created;
  } catch (error) {
    console.error('createEditingSession failed:', error);
    throw new Error('Failed to create editing session.', { cause: error });
  }
}

export async function updateEditingSession(
  sessionId: string,
  patch: Partial<typeof editingSessions.$inferInsert>
) {
  try {
    const [updated] = await db
      .update(editingSessions)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(editingSessions.id, sessionId))
      .returning();
    return updated;
  } catch (error) {
    console.error('updateEditingSession failed:', error);
    throw new Error('Failed to update editing session.', { cause: error });
  }
}

export async function createBackgroundJob(input: typeof backgroundJobs.$inferInsert) {
  try {
    const [job] = await db.insert(backgroundJobs).values(input).returning();
    return job;
  } catch (error) {
    console.error('createBackgroundJob failed:', error);
    throw new Error('Failed to record background job.', { cause: error });
  }
}

export async function updateBackgroundJob(
  jobId: string,
  patch: Partial<typeof backgroundJobs.$inferInsert>
) {
  try {
    const [job] = await db
      .update(backgroundJobs)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, jobId))
      .returning();
    return job;
  } catch (error) {
    console.error('updateBackgroundJob failed:', error);
    throw new Error('Failed to update background job.', { cause: error });
  }
}

export async function listBackgroundJobs(userId: number) {
  try {
    return await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.userId, userId))
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(25);
  } catch (error) {
    console.error('listBackgroundJobs failed:', error);
    throw new Error('Failed to load background jobs.', { cause: error });
  }
}

export async function writeAuditLog(input: typeof auditLogs.$inferInsert) {
  try {
    await db.insert(auditLogs).values(input);
  } catch (error) {
    console.error('writeAuditLog failed:', error);
  }
}

export async function listAuditLogs(userId: number, limit = 50) {
  try {
    return await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('listAuditLogs failed:', error);
    throw new Error('Failed to load audit logs.', { cause: error });
  }
}
