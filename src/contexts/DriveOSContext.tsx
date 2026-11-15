import { User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/apiClient';
import {
  clearGoogleAccessToken,
  getGoogleAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from '../lib/firebase';
import { IntegratedAppId, resolveOpenWithApp } from '../lib/openWithRouter';
import { GoogleDriveProvider } from '../providers/GoogleDriveProvider';
import { CloudFile, StorageProvider, StorageQuota } from '../providers/StorageProvider';

export interface DashboardCardConfig {
  id: string;
  title: string;
  visible: boolean;
  size: 'sm' | 'md' | 'lg';
  order: number;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  defaultViewMode: 'grid' | 'list' | 'compact';
  defaultOpenWith: Record<string, string>;
  dashboardLayout: DashboardCardConfig[];
}

export interface FileMetadataRecord {
  id: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  parentId: string | null;
  sizeBytes: string | null;
  isFavorite: boolean;
  isPinned: boolean;
  tags: string[];
  lastOpenedAt: string | null;
  updatedAt: string;
}

export interface WordEditingSession {
  id: string;
  driveFileId: string;
  driveFileName: string;
  driveMimeType: string;
  isGoogleDoc: boolean;
  originalDriveModifiedTime: string | null;
  originalDriveMd5: string | null;
  originalDriveSize: string | null;
  onedriveItemId: string | null;
  onedriveWebUrl: string | null;
  onedriveTempPath: string | null;
  status: string;
  syncAttempts: number;
  lastError: string | null;
  lastVerifiedSize: string | null;
  lastVerifiedModifiedTime: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface MicrosoftConnectionStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  redirectUri: string;
}

export interface WorkspaceWindow {
  id: string;
  appId: IntegratedAppId;
  title: string;
  file?: CloudFile;
  initialContent?: string;
  targetFolderId?: string;
  extraFileIds?: string[];
}

export type ActiveNavView =
  | 'dashboard'
  | 'explorer'
  | 'favorites'
  | 'recent'
  | 'trash'
  | 'word-sync'
  | 'apps'
  | 'settings';

interface DriveOSContextValue {
  firebaseUser: User | null;
  hasGoogleToken: boolean;
  authLoading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  storageProvider: StorageProvider;
  quota: StorageQuota | null;
  refreshQuota: () => Promise<void>;
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  metadataMap: Map<string, FileMetadataRecord>;
  metadataList: FileMetadataRecord[];
  refreshMetadata: () => Promise<void>;
  toggleFavorite: (file: CloudFile) => Promise<void>;
  togglePin: (file: CloudFile) => Promise<void>;
  updateTags: (file: CloudFile, tags: string[]) => Promise<void>;
  recordRecent: (file: CloudFile) => Promise<void>;
  microsoftStatus: MicrosoftConnectionStatus;
  refreshProfile: () => Promise<void>;
  connectMicrosoft: () => Promise<void>;
  disconnectMicrosoft: (force?: boolean) => Promise<void>;
  wordSessions: WordEditingSession[];
  refreshWordSessions: () => Promise<void>;
  startWordOnlineSession: (file: CloudFile) => Promise<WordEditingSession | null>;
  finishWordOnlineSession: (
    sessionId: string,
    opts?: { saveMode?: 'overwrite_docx' | 'new_docx' | 'new_google_doc'; forceOverwrite?: boolean }
  ) => Promise<{ ok: boolean; conflict?: boolean; error?: string; session?: WordEditingSession }>;
  activeNav: ActiveNavView;
  setActiveNav: (nav: ActiveNavView) => void;
  currentFolderId: string;
  setCurrentFolderId: (id: string) => void;
  openFileWithApp: (file: CloudFile, appOverride?: IntegratedAppId) => void;
  openNewAppWindow: (win: Omit<WorkspaceWindow, 'id'>) => void;
  windows: WorkspaceWindow[];
  activeWindowId: string | null;
  setActiveWindowId: (id: string | null) => void;
  closeWindow: (id: string) => void;
  explorerRefreshTick: number;
  triggerExplorerRefresh: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  defaultViewMode: 'grid',
  defaultOpenWith: {
    '.docx': 'word-online',
    '.md': 'markdown',
    '.pdf': 'pdf',
    '.epub': 'ebook',
    '.zip': 'archive',
    '.excalidraw': 'excalidraw',
    '.drawio': 'drawio',
    '.mmd': 'mermaid',
    '.sqlite': 'sqlite',
    '.sqlite3': 'sqlite',
    '.db': 'sqlite',
  },
  dashboardLayout: [
    { id: 'quick-actions', title: 'Quick Actions', visible: true, size: 'lg', order: 0 },
    { id: 'storage-overview', title: 'Storage Overview', visible: true, size: 'md', order: 1 },
    { id: 'sync-sessions', title: 'Word Online & Sync', visible: true, size: 'md', order: 2 },
    { id: 'favorites', title: 'Favorites & Pinned', visible: true, size: 'md', order: 3 },
    { id: 'recent-files', title: 'Recent Files', visible: true, size: 'lg', order: 4 },
    { id: 'recent-folders', title: 'Frequently Accessed Folders', visible: true, size: 'md', order: 5 },
    { id: 'integrated-apps', title: 'Integrated Apps', visible: true, size: 'md', order: 6 },
    { id: 'file-activity', title: 'Activity & Audit', visible: true, size: 'md', order: 7 },
  ],
};

const DriveOSContext = createContext<DriveOSContextValue | null>(null);

export const useDriveOS = () => {
  const ctx = useContext(DriveOSContext);
  if (!ctx) throw new Error('useDriveOS must be used inside DriveOSProvider');
  return ctx;
};

export const DriveOSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [microsoftStatus, setMicrosoftStatus] = useState<MicrosoftConnectionStatus>({
    configured: false,
    connected: false,
    accountEmail: null,
    accountName: null,
    redirectUri: '',
  });

  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [metadataList, setMetadataList] = useState<FileMetadataRecord[]>([]);
  const [wordSessions, setWordSessions] = useState<WordEditingSession[]>([]);

  const [activeNav, setActiveNav] = useState<ActiveNavView>('dashboard');
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [windows, setWindows] = useState<WorkspaceWindow[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [explorerRefreshTick, setExplorerRefreshTick] = useState(0);

  const triggerExplorerRefresh = useCallback(() => {
    setExplorerRefreshTick((t) => t + 1);
  }, []);

  const handleUnauthorizedDrive = useCallback(() => {
    clearGoogleAccessToken();
    setHasGoogleToken(false);
  }, []);

  const storageProvider = useMemo(
    () => new GoogleDriveProvider(getGoogleAccessToken, handleUnauthorizedDrive),
    [handleUnauthorizedDrive]
  );

  // Apply theme class to document.documentElement
  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      if (dark) root.classList.add('dark');
      else root.classList.remove('dark');
    };
    if (settings.theme === 'dark') {
      apply(true);
    } else if (settings.theme === 'light') {
      apply(false);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [settings.theme]);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await apiFetch<{
        settings: UserSettings;
        microsoft: MicrosoftConnectionStatus;
      }>('/api/user/me');
      if (data.settings) setSettings(data.settings);
      if (data.microsoft) setMicrosoftStatus(data.microsoft);
    } catch (err) {
      console.error('Failed to load profile:', err);
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: FileMetadataRecord[] }>('/api/metadata');
      setMetadataList(data.items || []);
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  }, []);

  const refreshWordSessions = useCallback(async () => {
    try {
      const data = await apiFetch<{ sessions: WordEditingSession[] }>('/api/word-sessions');
      setWordSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to load word sessions:', err);
    }
  }, []);

  const refreshQuota = useCallback(async () => {
    if (!getGoogleAccessToken()) return;
    try {
      const q = await storageProvider.getQuota();
      setQuota(q);
    } catch (err) {
      console.error('Failed to fetch Drive quota:', err);
    }
  }, [storageProvider]);

  useEffect(() => {
    const unsub = initAuth(
      (user, gToken) => {
        setFirebaseUser(user);
        setHasGoogleToken(Boolean(gToken));
        setAuthLoading(false);
        refreshProfile();
        refreshMetadata();
        refreshWordSessions();
        if (gToken) refreshQuota();
      },
      () => {
        setFirebaseUser(null);
        setHasGoogleToken(false);
        setAuthLoading(false);
      },
      (configErr) => {
        setAuthError(configErr);
        setAuthLoading(false);
      }
    );
    return () => unsub();
  }, [refreshMetadata, refreshProfile, refreshQuota, refreshWordSessions]);

  // Listen for Microsoft OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === 'MICROSOFT_OAUTH_SUCCESS') {
        toast.success('Microsoft OneDrive connected for Word Online editing');
        refreshProfile();
      } else if (event.data?.type === 'MICROSOFT_OAUTH_ERROR') {
        toast.error(event.data.error || 'Microsoft connection failed');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshProfile]);

  const signIn = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      setFirebaseUser(res.user);
      setHasGoogleToken(true);
      await Promise.all([refreshProfile(), refreshMetadata(), refreshWordSessions(), refreshQuota()]);
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  }, [refreshMetadata, refreshProfile, refreshQuota, refreshWordSessions]);

  const signOut = useCallback(async () => {
    await logout();
    setFirebaseUser(null);
    setHasGoogleToken(false);
    setQuota(null);
    setWindows([]);
    setActiveWindowId(null);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const data = await apiFetch<{ settings: UserSettings }>('/api/user/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      if (data.settings) setSettings(data.settings);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    }
  }, []);

  const metadataMap = useMemo(() => {
    const m = new Map<string, FileMetadataRecord>();
    for (const item of metadataList) {
      m.set(item.fileId, item);
    }
    return m;
  }, [metadataList]);

  const toggleFavorite = useCallback(
    async (file: CloudFile) => {
      const current = metadataMap.get(file.id)?.isFavorite ?? false;
      try {
        await apiFetch('/api/metadata/favorite', {
          method: 'POST',
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            parentId: file.parents?.[0] || null,
            sizeBytes: file.size || null,
            isFavorite: !current,
          }),
        });
        await refreshMetadata();
        toast.success(!current ? `Added "${file.name}" to favorites` : `Removed from favorites`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to update favorite');
      }
    },
    [metadataMap, refreshMetadata]
  );

  const togglePin = useCallback(
    async (file: CloudFile) => {
      const current = metadataMap.get(file.id)?.isPinned ?? false;
      try {
        await apiFetch('/api/metadata/pin', {
          method: 'POST',
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            parentId: file.parents?.[0] || null,
            sizeBytes: file.size || null,
            isPinned: !current,
          }),
        });
        await refreshMetadata();
        toast.success(!current ? `Pinned "${file.name}"` : `Unpinned "${file.name}"`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to update pin');
      }
    },
    [metadataMap, refreshMetadata]
  );

  const updateTags = useCallback(
    async (file: CloudFile, tags: string[]) => {
      try {
        await apiFetch('/api/metadata/tags', {
          method: 'POST',
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            parentId: file.parents?.[0] || null,
            sizeBytes: file.size || null,
            tags,
          }),
        });
        await refreshMetadata();
        toast.success('Tags updated');
      } catch (err: any) {
        toast.error(err.message || 'Failed to update tags');
      }
    },
    [refreshMetadata]
  );

  const recordRecent = useCallback(
    async (file: CloudFile) => {
      try {
        await apiFetch('/api/metadata/recent', {
          method: 'POST',
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            parentId: file.parents?.[0] || null,
            sizeBytes: file.size || null,
          }),
        });
        await refreshMetadata();
      } catch {
        // non-blocking
      }
    },
    [refreshMetadata]
  );

  const connectMicrosoft = useCallback(async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/api/microsoft/auth-url');
      const popup = window.open(url, 'ms_oauth_popup', 'width=620,height=720');
      if (!popup) {
        toast.error('Popup was blocked by your browser. Please allow popups for this site.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate Microsoft OneDrive sign-in');
    }
  }, []);

  const disconnectMicrosoft = useCallback(
    async (force = false) => {
      await apiFetch('/api/microsoft/disconnect', {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      await refreshProfile();
      toast.success('Microsoft OneDrive disconnected');
    },
    [refreshProfile]
  );

  const startWordOnlineSession = useCallback(
    async (file: CloudFile): Promise<WordEditingSession | null> => {
      if (!microsoftStatus.connected) {
        toast.error('Connect Microsoft OneDrive in Settings before opening documents in Word Online.');
        setActiveNav('settings');
        setActiveWindowId(null);
        return null;
      }
      const loadingId = toast.loading(`Preparing temporary OneDrive copy for "${file.name}"...`);
      try {
        const data = await apiFetch<{ session: WordEditingSession; wordOnlineUrl: string }>(
          '/api/word-sessions/start',
          {
            method: 'POST',
            body: JSON.stringify({ fileId: file.id }),
          }
        );
        toast.dismiss(loadingId);
        await refreshWordSessions();
        if (data.wordOnlineUrl) {
          window.open(data.wordOnlineUrl, '_blank', 'noopener,noreferrer');
        }
        toast.success(
          'Word Online opened in a new tab. Click "Finish Editing & Sync" here when you are done.'
        );
        setActiveNav('word-sync');
        setActiveWindowId(null);
        return data.session;
      } catch (err: any) {
        toast.dismiss(loadingId);
        toast.error(err.message || 'Failed to start Word Online editing session');
        await refreshWordSessions();
        return null;
      }
    },
    [microsoftStatus.connected, refreshWordSessions]
  );

  const finishWordOnlineSession = useCallback(
    async (
      sessionId: string,
      opts?: { saveMode?: 'overwrite_docx' | 'new_docx' | 'new_google_doc'; forceOverwrite?: boolean }
    ) => {
      try {
        const data = await apiFetch<{ session: WordEditingSession; driveFile: any }>(
          `/api/word-sessions/${encodeURIComponent(sessionId)}/finish`,
          {
            method: 'POST',
            body: JSON.stringify(opts || {}),
          }
        );
        await refreshWordSessions();
        triggerExplorerRefresh();
        toast.success('Synchronization verified and temporary OneDrive file deleted safely.');
        return { ok: true, session: data.session };
      } catch (err: any) {
        await refreshWordSessions();
        if (err.status === 409) {
          return {
            ok: false,
            conflict: true,
            error: err.message,
            session: err.payload?.session,
          };
        }
        return {
          ok: false,
          error: err.message || 'Synchronization failed',
          session: err.payload?.session,
        };
      }
    },
    [refreshWordSessions, triggerExplorerRefresh]
  );

  const openNewAppWindow = useCallback((win: Omit<WorkspaceWindow, 'id'>) => {
    const id = `${win.appId}-${win.file?.id || Date.now()}`;
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) return prev;
      return [...prev, { ...win, id }];
    });
    setActiveWindowId(id);
  }, []);

  const closeWindow = useCallback(
    (id: string) => {
      setWindows((prev) => {
        const next = prev.filter((w) => w.id !== id);
        if (activeWindowId === id) {
          setActiveWindowId(next[next.length - 1]?.id || null);
        }
        return next;
      });
    },
    [activeWindowId]
  );

  const openFileWithApp = useCallback(
    (file: CloudFile, appOverride?: IntegratedAppId) => {
      if (file.isFolder) {
        setCurrentFolderId(file.id);
        setActiveNav('explorer');
        setActiveWindowId(null);
        return;
      }

      recordRecent(file);
      let targetApp = appOverride || resolveOpenWithApp(file, settings.defaultOpenWith);

      if (targetApp === 'word-online') {
        if (!appOverride && !microsoftStatus.connected) {
          if (file.mimeType === 'application/vnd.google-apps.document') {
            targetApp = 'google-docs-export';
            toast.info('Word Online is not connected — opened Google Docs preview instead.');
          } else {
            targetApp = 'docx-viewer';
            toast.info('Word Online is not connected — opened in Built-in DOCX Viewer.');
          }
        } else {
          startWordOnlineSession(file);
          return;
        }
      }

      if (targetApp === 'external' || targetApp === 'excel-online' || targetApp === 'powerpoint-online') {
        if (file.webViewLink) {
          window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
        } else {
          toast.info('No external viewer link available for this file.');
        }
        return;
      }

      openNewAppWindow({
        appId: targetApp,
        title: file.name,
        file,
        targetFolderId: file.parents?.[0] || currentFolderId,
      });
    },
    [
      currentFolderId,
      microsoftStatus.connected,
      openNewAppWindow,
      recordRecent,
      settings.defaultOpenWith,
      startWordOnlineSession,
    ]
  );

  return (
    <DriveOSContext.Provider
      value={{
        firebaseUser,
        hasGoogleToken,
        authLoading,
        authError,
        signIn,
        signOut,
        storageProvider,
        quota,
        refreshQuota,
        settings,
        updateSettings,
        metadataMap,
        metadataList,
        refreshMetadata,
        toggleFavorite,
        togglePin,
        updateTags,
        recordRecent,
        microsoftStatus,
        refreshProfile,
        connectMicrosoft,
        disconnectMicrosoft,
        wordSessions,
        refreshWordSessions,
        startWordOnlineSession,
        finishWordOnlineSession,
        activeNav,
        setActiveNav,
        currentFolderId,
        setCurrentFolderId,
        openFileWithApp,
        openNewAppWindow,
        windows,
        activeWindowId,
        setActiveWindowId,
        closeWindow,
        explorerRefreshTick,
        triggerExplorerRefresh,
      }}
    >
      {children}
    </DriveOSContext.Provider>
  );
};
