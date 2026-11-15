import {
  Archive,
  ArrowDown,
  ArrowUp,
  Clock,
  Database,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Upload,
  Workflow,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DashboardCardConfig, useDriveOS } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import { formatBytes, formatRelativeDate } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';

export const DashboardView: React.FC = () => {
  const {
    storageProvider,
    quota,
    refreshQuota,
    settings,
    updateSettings,
    metadataList,
    wordSessions,
    setActiveNav,
    setCurrentFolderId,
    openNewAppWindow,
    openFileWithApp,
    currentFolderId,
    triggerExplorerRefresh,
  } = useDriveOS();

  const [recentDriveFiles, setRecentDriveFiles] = useState<CloudFile[]>([]);
  const [recentFolders, setRecentFolders] = useState<CloudFile[]>([]);
  const [auditLogs, setAuditLogs] = useState<
    { id: number; action: string; targetName: string | null; status: string; createdAt: string }[]
  >([]);
  const [customizing, setCustomizing] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshQuota();
    storageProvider
      .listFiles({ orderBy: 'modifiedTime desc', pageSize: 8 })
      .then((res) => setRecentDriveFiles(res.files.filter((f) => !f.isFolder).slice(0, 6)))
      .catch(() => {});

    storageProvider
      .listAllFolders()
      .then((f) => setRecentFolders(f.slice(0, 6)))
      .catch(() => {});

    apiFetch<{ logs: any[] }>('/api/user/audit-logs')
      .then((d) => setAuditLogs((d.logs || []).slice(0, 6)))
      .catch(() => {});
  }, [refreshQuota, storageProvider]);

  const sortedLayout = [...(settings.dashboardLayout || [])].sort((a, b) => a.order - b.order);

  const toggleCardVisibility = (id: string) => {
    const next = sortedLayout.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
    updateSettings({ dashboardLayout: next });
  };

  const moveCard = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sortedLayout.length) return;
    const copy = [...sortedLayout];
    const tmp = copy[index];
    copy[index] = copy[target];
    copy[target] = tmp;
    const reordered = copy.map((c, idx) => ({ ...c, order: idx }));
    updateSettings({ dashboardLayout: reordered });
  };

  const cycleCardSize = (id: string) => {
    const next = sortedLayout.map((c) => {
      if (c.id !== id) return c;
      const order: ('sm' | 'md' | 'lg')[] = ['sm', 'md', 'lg'];
      const idx = (order.indexOf(c.size) + 1) % order.length;
      return { ...c, size: order[idx] };
    });
    updateSettings({ dashboardLayout: next });
  };

  const handleQuickUpload = async (files: FileList) => {
    const toastId = toast.loading(`Uploading ${files.length} file(s)...`);
    try {
      for (const f of Array.from(files)) {
        await storageProvider.uploadFile(f, f.name, f.type || 'application/octet-stream', currentFolderId);
      }
      toast.dismiss(toastId);
      toast.success('Uploaded to Google Drive');
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Upload failed');
    }
  };

  const favorites = metadataList.filter((m) => m.isFavorite);
  const pinnedFolders = metadataList.filter((m) => m.isPinned);
  const pendingSessions = wordSessions.filter((s) => s.status !== 'completed');

  const usagePercent =
    quota?.limit && quota.limit > 0 ? Math.min(100, (quota.usage / quota.limit) * 100) : 0;

  const spanClass = (size: DashboardCardConfig['size']) => {
    if (size === 'lg') return 'md:col-span-2 xl:col-span-6';
    if (size === 'md') return 'md:col-span-1 xl:col-span-4';
    return 'md:col-span-1 xl:col-span-3';
  };

  const renderCardBody = (card: DashboardCardConfig) => {
    switch (card.id) {
      case 'quick-actions':
        return (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <Upload className="h-4 w-4 text-blue-600" />
              <span>Upload Files</span>
            </button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleQuickUpload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => setActiveNav('explorer')}
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <FolderPlus className="h-4 w-4 text-blue-600" />
              <span>Browse Drive</span>
            </button>
            <button
              type="button"
              onClick={() =>
                openNewAppWindow({ appId: 'markdown', title: 'New Markdown.md', targetFolderId: currentFolderId })
              }
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <FileCode2 className="h-4 w-4 text-blue-600" />
              <span>New Markdown</span>
            </button>
            <button
              type="button"
              onClick={() =>
                openNewAppWindow({ appId: 'excalidraw', title: 'New Diagram.excalidraw', targetFolderId: currentFolderId })
              }
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <Workflow className="h-4 w-4 text-indigo-600" />
              <span>New Excalidraw</span>
            </button>
            <button
              type="button"
              onClick={() =>
                openNewAppWindow({ appId: 'drawio', title: 'Architecture.drawio', targetFolderId: currentFolderId })
              }
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <Workflow className="h-4 w-4 text-emerald-600" />
              <span>New Draw.io</span>
            </button>
            <button
              type="button"
              onClick={() =>
                openNewAppWindow({ appId: 'pdf', title: 'New Document.pdf', targetFolderId: currentFolderId })
              }
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <FilePlus2 className="h-4 w-4 text-red-600" />
              <span>Create PDF</span>
            </button>
            <button
              type="button"
              onClick={() =>
                openNewAppWindow({ appId: 'sqlite', title: 'database.sqlite', targetFolderId: currentFolderId })
              }
              className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <Database className="h-4 w-4 text-emerald-600" />
              <span>New SQLite DB</span>
            </button>
          </div>
        );

      case 'storage-overview':
        return (
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {quota ? formatBytes(quota.usage) : '—'}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {quota?.limit ? `of ${formatBytes(quota.limit)} Google Drive quota` : 'Used across Google Drive'}
                </p>
              </div>
              <HardDrive className="h-5 w-5 text-slate-400" />
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 text-xs tabular-nums">
              <div>
                <p className="text-slate-500">In Drive</p>
                <p className="font-mono font-medium text-slate-800 dark:text-slate-200">
                  {quota ? formatBytes(quota.usageInDrive) : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">In Trash</p>
                <p className="font-mono font-medium text-slate-800 dark:text-slate-200">
                  {quota ? formatBytes(quota.usageInDriveTrash) : '—'}
                </p>
              </div>
            </div>
          </div>
        );

      case 'sync-sessions':
        return pendingSessions.length === 0 ? (
          <div className="py-4 text-xs text-slate-500">
            <p>All Word Online editing sessions are synchronized.</p>
            <button
              type="button"
              onClick={() => setActiveNav('word-sync')}
              className="mt-2 font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Open Sync Hub
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingSessions.slice(0, 3).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                    {s.driveFileName}
                  </p>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{s.status}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveNav('word-sync')}
                  className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1 font-medium text-white"
                >
                  Sync
                </button>
              </div>
            ))}
          </div>
        );

      case 'favorites':
        return favorites.length === 0 && pinnedFolders.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">
            Star files or pin folders in the File Explorer for instant access here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {pinnedFolders.slice(0, 3).map((pf) => (
              <button
                key={`pin-${pf.fileId}`}
                type="button"
                onClick={() => {
                  setCurrentFolderId(pf.fileId);
                  setActiveNav('explorer');
                }}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="flex items-center gap-2 truncate font-medium text-slate-800 dark:text-slate-200">
                  <Pin className="h-3.5 w-3.5 text-blue-600" />
                  <span className="truncate">{pf.fileName}</span>
                </span>
                <span className="text-slate-400">Pinned</span>
              </button>
            ))}
            {favorites.slice(0, 4).map((fav) => (
              <button
                key={`fav-${fav.fileId}`}
                type="button"
                onClick={() =>
                  storageProvider
                    .getFile(fav.fileId)
                    .then((f) => openFileWithApp(f))
                    .catch(() => toast.error('Unable to open file'))
                }
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="flex items-center gap-2 truncate font-medium text-slate-800 dark:text-slate-200">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span className="truncate">{fav.fileName}</span>
                </span>
              </button>
            ))}
          </div>
        );

      case 'recent-files':
        return recentDriveFiles.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">No recently modified Drive files found.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentDriveFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => openFileWithApp(file)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-xs transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                  <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                    {file.name}
                  </span>
                </div>
                <span className="shrink-0 font-mono tabular-nums text-slate-500">
                  {formatBytes(file.size)} · {formatRelativeDate(file.modifiedTime)}
                </span>
              </button>
            ))}
          </div>
        );

      case 'recent-folders':
        return recentFolders.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">No folders found in Google Drive.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {recentFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setCurrentFolderId(folder.id);
                  setActiveNav('explorer');
                }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40"
              >
                <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
          </div>
        );

      case 'integrated-apps':
        return (
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Markdown Studio', appId: 'markdown' as const, icon: FileCode2 },
              { label: 'PDF Studio', appId: 'pdf' as const, icon: FileText },
              { label: 'SQLite Studio', appId: 'sqlite' as const, icon: Database },
              { label: 'Excalidraw', appId: 'excalidraw' as const, icon: Workflow },
              { label: 'Mermaid Studio', appId: 'mermaid' as const, icon: Archive },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => openNewAppWindow({ appId: item.appId, title: item.label })}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-800 hover:border-blue-400 dark:border-slate-800 dark:text-slate-200"
                >
                  <Icon className="h-4 w-4 text-blue-600" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        );

      case 'file-activity':
        return auditLogs.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">No recent activity logged yet.</p>
        ) : (
          <div className="space-y-2 text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                  {log.action.replace(/_/g, ' ').toLowerCase()} · {log.targetName || 'System'}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-slate-400">
                  {formatRelativeDate(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Workspace Overview
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Google Drive · Authoritative cloud storage and integrated productivity apps
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCustomizing((c) => !c)}
          className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
            customizing
              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#14171F] dark:text-slate-200'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {customizing ? 'Done Customizing' : 'Customize Bento Grid'}
        </button>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        {sortedLayout.map((card, idx) => {
          if (!card.visible && !customizing) return null;
          return (
            <section
              key={card.id}
              className={`${spanClass(card.size)} rounded-2xl border border-slate-200 bg-white p-5 transition dark:border-slate-800 dark:bg-[#14171F] ${
                !card.visible ? 'opacity-50' : ''
              }`}
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {card.title}
                </h2>
                {customizing && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => cycleCardSize(card.id)}
                      className="rounded-lg border border-slate-200 px-2 py-0.5 font-mono text-[10px] uppercase dark:border-slate-700"
                    >
                      {card.size}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCard(idx, -1)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCard(idx, 1)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCardVisibility(card.id)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {card.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
              {renderCardBody(card)}
            </section>
          );
        })}
      </div>
    </div>
  );
};
