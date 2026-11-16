import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export interface OpenWithPreferences {
  [extOrMime: string]: string;
}

export interface DashboardCardConfig {
  id: string;
  title: string;
  visible: boolean;
  size: 'sm' | 'md' | 'lg';
  order: number;
}

export const DEFAULT_OPEN_WITH: OpenWithPreferences = {
  '.docx': 'word-online',
  '.doc': 'word-online',
  '.xlsx': 'excel-online',
  '.pptx': 'powerpoint-online',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pdf': 'pdf',
  '.epub': 'ebook',
  '.zip': 'archive',
  '.excalidraw': 'excalidraw',
  '.drawio': 'drawio',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite',
  '.db': 'sqlite',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.txt': 'code',
  '.json': 'code',
  '.js': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.html': 'code',
  '.css': 'code',
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardCardConfig[] = [
  { id: 'quick-actions', title: 'Quick Actions', visible: true, size: 'lg', order: 0 },
  { id: 'storage-overview', title: 'Storage Overview', visible: true, size: 'md', order: 1 },
  { id: 'sync-sessions', title: 'Word Online & Sync', visible: true, size: 'md', order: 2 },
  { id: 'favorites', title: 'Favorites & Pinned', visible: true, size: 'md', order: 3 },
  { id: 'recent-files', title: 'Recent Files', visible: true, size: 'lg', order: 4 },
  { id: 'recent-folders', title: 'Frequently Accessed Folders', visible: true, size: 'md', order: 5 },
  { id: 'integrated-apps', title: 'Integrated Apps', visible: true, size: 'md', order: 6 },
  { id: 'file-activity', title: 'Activity & Audit', visible: true, size: 'md', order: 7 },
];

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  theme: text('theme').default('light').notNull(),
  defaultViewMode: text('default_view_mode').default('grid').notNull(),
  defaultOpenWith: jsonb('default_open_with').$type<OpenWithPreferences>().default(DEFAULT_OPEN_WITH).notNull(),
  dashboardLayout: jsonb('dashboard_layout').$type<DashboardCardConfig[]>().default(DEFAULT_DASHBOARD_LAYOUT).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(), // 'microsoft'
    accountEmail: text('account_email'),
    accountName: text('account_name'),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    expiresAt: timestamp('expires_at'),
    scopes: text('scopes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('connected_accounts_user_provider_idx').on(table.userId, table.provider),
  ]
);

export const fileMetadata = pgTable(
  'file_metadata',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').default('google-drive').notNull(),
    fileId: text('file_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    parentId: text('parent_id'),
    sizeBytes: text('size_bytes'),
    isFavorite: boolean('is_favorite').default(false).notNull(),
    isPinned: boolean('is_pinned').default(false).notNull(),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    folderIcon: text('folder_icon'),
    folderColor: text('folder_color'),
    lastOpenedAt: timestamp('last_opened_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('file_metadata_user_provider_file_idx').on(table.userId, table.provider, table.fileId),
  ]
);

export const editingSessions = pgTable('editing_sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  driveFileId: text('drive_file_id').notNull(),
  driveFileName: text('drive_file_name').notNull(),
  driveMimeType: text('drive_mime_type').notNull(),
  isGoogleDoc: boolean('is_google_doc').default(false).notNull(),
  originalDriveModifiedTime: text('original_drive_modified_time'),
  originalDriveMd5: text('original_drive_md5'),
  originalDriveSize: text('original_drive_size'),
  onedriveItemId: text('onedrive_item_id'),
  onedriveWebUrl: text('onedrive_web_url'),
  onedriveOriginalEtag: text('onedrive_original_etag'),
  onedriveTempPath: text('onedrive_temp_path'),
  status: text('status').default('creating').notNull(),
  syncAttempts: integer('sync_attempts').default(0).notNull(),
  lastError: text('last_error'),
  lastVerifiedSize: text('last_verified_size'),
  lastVerifiedModifiedTime: text('last_verified_modified_time'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
});

export const backgroundJobs = pgTable('background_jobs', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  jobType: text('job_type').notNull(),
  status: text('status').default('pending').notNull(),
  progress: integer('progress').default(0).notNull(),
  summary: text('summary').notNull(),
  resultMeta: jsonb('result_meta').$type<Record<string, unknown>>(),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  targetName: text('target_name'),
  status: text('status').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ebookReadingStates = pgTable(
  'ebook_reading_states',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    fileId: text('file_id').notNull(),
    fileName: text('file_name').notNull(),
    format: text('format').default('epub').notNull(),
    currentLocation: text('current_location').default('1').notNull(),
    currentPage: integer('current_page').default(1).notNull(),
    totalPages: integer('total_pages').default(1).notNull(),
    scrollPercent: integer('scroll_percent').default(0).notNull(),
    progressPercent: integer('progress_percent').default(0).notNull(),
    bookTitle: text('book_title'),
    bookAuthor: text('book_author'),
    lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ebook_reading_states_user_file_idx').on(table.userId, table.fileId),
  ]
);

export const ebookAnnotations = pgTable(
  'ebook_annotations',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    fileId: text('file_id').notNull(),
    fileName: text('file_name').notNull(),
    format: text('format').default('epub').notNull(),
    pageNumber: integer('page_number').default(1).notNull(),
    chapterTitle: text('chapter_title'),
    quoteText: text('quote_text').default('').notNull(),
    noteText: text('note_text').default('').notNull(),
    color: text('color').default('yellow').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('ebook_annotations_user_file_idx').on(table.userId, table.fileId),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  connectedAccounts: many(connectedAccounts),
  fileMetadata: many(fileMetadata),
  editingSessions: many(editingSessions),
  backgroundJobs: many(backgroundJobs),
  auditLogs: many(auditLogs),
  ebookReadingStates: many(ebookReadingStates),
  ebookAnnotations: many(ebookAnnotations),
}));
