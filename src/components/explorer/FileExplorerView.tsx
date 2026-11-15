import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  CheckSquare,
  ChevronRight,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Grid2x2,
  Info,
  List,
  MoreVertical,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  Tag,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import { getCompatibleApps } from '../../lib/openWithRouter';
import { formatBytes, formatRelativeDate, getFileExtension } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

function FileTypeIcon({ file, className = 'h-5 w-5' }: { file: CloudFile; className?: string }) {
  if (file.isFolder) return <Folder className={`${className} text-blue-600 dark:text-blue-400`} />;
  const ext = getFileExtension(file.name);
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
    return <FileImage className={`${className} text-emerald-600 dark:text-emerald-400`} />;
  }
  if (ext === '.zip' || ext === '.rar' || mime.includes('zip')) {
    return <Archive className={`${className} text-amber-600 dark:text-amber-400`} />;
  }
  if (ext === '.excalidraw' || ext === '.drawio' || ext === '.mmd') {
    return <Workflow className={`${className} text-indigo-600 dark:text-indigo-400`} />;
  }
  if (['.sqlite', '.sqlite3', '.db'].includes(ext) || mime.includes('sqlite')) {
    return <Database className={`${className} text-emerald-600 dark:text-emerald-400`} />;
  }
  if (mime.includes('spreadsheet') || ext === '.xlsx') {
    return <FileSpreadsheet className={`${className} text-emerald-600 dark:text-emerald-400`} />;
  }
  if (['.md', '.json', '.js', '.ts', '.tsx', '.html', '.css', '.txt'].includes(ext)) {
    return <FileCode2 className={`${className} text-slate-600 dark:text-slate-300`} />;
  }
  if (ext === '.pdf' || mime === 'application/pdf') {
    return <FileText className={`${className} text-red-600 dark:text-red-400`} />;
  }
  return <FileText className={`${className} text-blue-600 dark:text-blue-400`} />;
}

interface FileExplorerViewProps {
  mode?: 'drive' | 'favorites' | 'recent' | 'trash';
}

export const FileExplorerView: React.FC<FileExplorerViewProps> = ({ mode = 'drive' }) => {
  const {
    storageProvider,
    settings,
    currentFolderId,
    setCurrentFolderId,
    metadataMap,
    metadataList,
    toggleFavorite,
    togglePin,
    updateTags,
    openFileWithApp,
    openNewAppWindow,
    explorerRefreshTick,
    triggerExplorerRefresh,
  } = useDriveOS();

  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>(settings.defaultViewMode);
  const [showTree, setShowTree] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Filters & sorting
  const [search, setSearch] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [extensionFilter, setExtensionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [orderBy, setOrderBy] = useState<'folder,name' | 'name' | 'modifiedTime desc' | 'quotaBytesUsed desc'>('folder,name');

  // Selection & Inspector
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorFile, setInspectorFile] = useState<CloudFile | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  // Context Menu (desktop right-click / mobile long-press)
  const [contextMenu, setContextMenu] = useState<{
    file: CloudFile;
    x: number;
    y: number;
    mobileSheet?: boolean;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  // Action Modals
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<CloudFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTargets, setMoveTargets] = useState<CloudFile[] | null>(null);
  const [moveDestId, setMoveDestId] = useState('root');
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkSuffix, setBulkSuffix] = useState('');
  const [confirmTrashTargets, setConfirmTrashTargets] = useState<CloudFile[] | null>(null);
  const [confirmPermDeleteTargets, setConfirmPermDeleteTargets] = useState<CloudFile[] | null>(null);
  const [confirmMutationAction, setConfirmMutationAction] = useState<{
    title: string;
    description: string;
    label: string;
    run: () => Promise<void>;
  } | null>(null);

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isDraggingLocalFiles, setIsDraggingLocalFiles] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const loadFolderTree = useCallback(async () => {
    try {
      const all = await storageProvider.listAllFolders();
      setFolders(all);
    } catch {
      // ignore
    }
  }, [storageProvider]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'favorites') {
        const favIds = new Set(metadataList.filter((m) => m.isFavorite).map((m) => m.fileId));
        const res = await storageProvider.listFiles({ orderBy, pageSize: 100 });
        const favFiles = res.files.filter((f) => favIds.has(f.id));
        // Also fetch any favorites not in the top 100
        const present = new Set(favFiles.map((f) => f.id));
        const missing = Array.from(favIds).filter((id) => !present.has(id));
        const extra = await Promise.all(
          missing.slice(0, 20).map((id) => storageProvider.getFile(id).catch(() => null))
        );
        setFiles([...favFiles, ...(extra.filter(Boolean) as CloudFile[])]);
        setLoading(false);
        return;
      }

      if (mode === 'recent') {
        const recents = [...metadataList]
          .filter((m) => m.lastOpenedAt)
          .sort((a, b) => new Date(b.lastOpenedAt!).getTime() - new Date(a.lastOpenedAt!).getTime())
          .slice(0, 30);
        const loaded = await Promise.all(
          recents.map((r) => storageProvider.getFile(r.fileId).catch(() => null))
        );
        setFiles(loaded.filter((f): f is CloudFile => Boolean(f) && !f?.trashed));
        setLoading(false);
        return;
      }

      let modifiedAfter: string | undefined;
      if (dateFilter === '24h') {
        modifiedAfter = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      } else if (dateFilter === '7d') {
        modifiedAfter = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      } else if (dateFilter === '30d') {
        modifiedAfter = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      }

      let minSizeBytes: number | undefined;
      let maxSizeBytes: number | undefined;
      if (sizeFilter === 'small') maxSizeBytes = 1024 * 1024;
      if (sizeFilter === 'medium') {
        minSizeBytes = 1024 * 1024;
        maxSizeBytes = 10 * 1024 * 1024;
      }
      if (sizeFilter === 'large') minSizeBytes = 10 * 1024 * 1024;

      const res = await storageProvider.listFiles({
        folderId: mode === 'trash' ? undefined : currentFolderId,
        trashedOnly: mode === 'trash',
        search: search || undefined,
        mimeFilter: mimeFilter || undefined,
        extensionFilter: extensionFilter || undefined,
        modifiedAfter,
        minSizeBytes,
        maxSizeBytes,
        orderBy,
      });
      setFiles(res.files);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load files from Google Drive');
    } finally {
      setLoading(false);
    }
  }, [
    currentFolderId,
    dateFilter,
    extensionFilter,
    metadataList,
    mimeFilter,
    mode,
    orderBy,
    search,
    sizeFilter,
    storageProvider,
  ]);

  useEffect(() => {
    loadFiles();
    loadFolderTree();
  }, [loadFiles, loadFolderTree, explorerRefreshTick]);

  // Build breadcrumbs when currentFolderId changes
  useEffect(() => {
    if (currentFolderId === 'root') {
      setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
      return;
    }
    const map = new Map(folders.map((f) => [f.id, f]));
    const trail: { id: string; name: string }[] = [];
    let cursor: string | undefined = currentFolderId;
    let guard = 0;
    while (cursor && cursor !== 'root' && guard < 12) {
      const node = map.get(cursor);
      if (!node) break;
      trail.unshift({ id: node.id, name: node.name });
      cursor = node.parents?.[0];
      guard++;
    }
    setBreadcrumbs([{ id: 'root', name: 'My Drive' }, ...trail]);
  }, [currentFolderId, folders]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(files.map((f) => f.id)));
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setContextMenu(null);
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        const selected = files.filter((f) => selectedIds.has(f.id));
        if (mode === 'trash') setConfirmPermDeleteTargets(selected);
        else setConfirmTrashTargets(selected);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [files, mode, selectedIds]);

  const selectedFiles = useMemo(
    () => files.filter((f) => selectedIds.has(f.id)),
    [files, selectedIds]
  );

  const toggleSelect = (id: string, multi = true) => {
    setSelectedIds((prev) => {
      const next = multi ? new Set(prev) : new Set<string>();
      if (prev.has(id) && multi) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const toastId = toast.loading(`Uploading ${arr.length} file(s) to Google Drive...`);
    try {
      for (const f of arr) {
        await storageProvider.uploadFile(
          f,
          f.name,
          f.type || 'application/octet-stream',
          currentFolderId
        );
      }
      toast.dismiss(toastId);
      toast.success(`Uploaded ${arr.length} file(s)`);
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Upload failed');
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await storageProvider.createFolder(name, currentFolderId);
      setNewFolderOpen(false);
      setNewFolderName('');
      toast.success(`Created folder "${name}"`);
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create folder');
    }
  };

  const handleDownloadFile = async (file: CloudFile) => {
    if (file.isFolder) {
      openNewAppWindow({
        appId: 'archive',
        title: `Archive: ${file.name}`,
        extraFileIds: [file.id],
        targetFolderId: currentFolderId,
      });
      return;
    }
    const toastId = toast.loading(`Downloading "${file.name}"...`);
    try {
      const blob = file.isGoogleWorkspaceDoc
        ? await storageProvider.exportBlob(file.id, 'application/pdf')
        : await storageProvider.downloadBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.isGoogleWorkspaceDoc ? `${file.name}.pdf` : file.name;
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Download failed');
    }
  };

  const handleTrashConfirmed = async () => {
    if (!confirmTrashTargets) return;
    const targets = confirmTrashTargets;
    setConfirmTrashTargets(null);
    const toastId = toast.loading(`Moving ${targets.length} item(s) to Trash...`);
    try {
      for (const f of targets) {
        await storageProvider.trashFile(f.id);
        await apiFetch('/api/metadata/audit', {
          method: 'POST',
          body: JSON.stringify({
            action: 'FILE_TRASHED',
            targetType: 'drive_file',
            targetId: f.id,
            targetName: f.name,
            status: 'success',
          }),
        }).catch(() => {});
      }
      toast.dismiss(toastId);
      toast.success(`Moved ${targets.length} item(s) to Trash`);
      setSelectedIds(new Set());
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Failed to trash item(s)');
    }
  };

  const handlePermDeleteConfirmed = async () => {
    if (!confirmPermDeleteTargets) return;
    const targets = confirmPermDeleteTargets;
    setConfirmPermDeleteTargets(null);
    const toastId = toast.loading(`Deleting ${targets.length} item(s) permanently...`);
    try {
      for (const f of targets) {
        await storageProvider.deletePermanently(f.id);
        await apiFetch('/api/metadata/audit', {
          method: 'POST',
          body: JSON.stringify({
            action: 'FILE_DELETED_PERMANENTLY',
            targetType: 'drive_file',
            targetId: f.id,
            targetName: f.name,
            status: 'success',
          }),
        }).catch(() => {});
      }
      toast.dismiss(toastId);
      toast.success(`Permanently deleted ${targets.length} item(s)`);
      setSelectedIds(new Set());
      triggerExplorerRefresh();
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Permanent delete failed');
    }
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const draggedIdsJson = e.dataTransfer.getData('application/x-driveos-file-ids');
    if (!draggedIdsJson) return;
    const ids: string[] = JSON.parse(draggedIdsJson);
    const draggedFiles = files.filter((f) => ids.includes(f.id) && f.id !== targetFolderId);
    if (draggedFiles.length === 0) return;

    const targetName =
      targetFolderId === 'root'
        ? 'My Drive'
        : folders.find((f) => f.id === targetFolderId)?.name || 'Target Folder';

    setConfirmMutationAction({
      title: `Move ${draggedFiles.length} item(s) to "${targetName}"?`,
      description: 'Confirm moving the dragged files to this destination folder in Google Drive.',
      label: 'Move Files',
      run: async () => {
        for (const f of draggedFiles) {
          await storageProvider.moveFile(f.id, f.parents || [], targetFolderId);
        }
        toast.success(`Moved ${draggedFiles.length} item(s) to "${targetName}"`);
        setSelectedIds(new Set());
        triggerExplorerRefresh();
      },
    });
  };

  const openContextForFile = (file: CloudFile, x: number, y: number, mobileSheet = false) => {
    setContextMenu({
      file,
      x: Math.min(x, window.innerWidth - 230),
      y: Math.min(y, window.innerHeight - 320),
      mobileSheet,
    });
  };

  const childFoldersOf = useCallback(
    (parentId: string) => folders.filter((f) => (f.parents?.[0] || 'root') === parentId),
    [folders]
  );

  return (
    <div
      className="flex h-[calc(100vh-11rem)] min-h-[540px] overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsDraggingLocalFiles(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingLocalFiles(false);
      }}
      onDrop={(e) => {
        setIsDraggingLocalFiles(false);
        if (e.dataTransfer.files?.length > 0) {
          e.preventDefault();
          handleUploadFiles(e.dataTransfer.files);
        }
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Left Folder Tree */}
      {mode === 'drive' && showTree && (
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-slate-200 p-3 lg:block dark:border-slate-800">
          <p className="px-2 pb-2 text-xs font-semibold text-slate-500">Folder Hierarchy</p>
          <button
            type="button"
            onClick={() => setCurrentFolderId('root')}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId('root');
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDropOnFolder(e, 'root')}
            className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition ${
              currentFolderId === 'root'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            } ${dragOverFolderId === 'root' ? 'ring-2 ring-blue-500' : ''}`}
          >
            <Folder className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="truncate">My Drive</span>
          </button>

          <div className="mt-1 space-y-0.5 pl-2">
            {childFoldersOf('root').map((folder) => {
              const sub = childFoldersOf(folder.id);
              return (
                <div key={folder.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(folder.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverFolderId(folder.id);
                    }}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => handleDropOnFolder(e, folder.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                      currentFolderId === folder.id
                        ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    } ${dragOverFolderId === folder.id ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  {sub.length > 0 && (
                    <div className="space-y-0.5 pl-3">
                      {sub.slice(0, 8).map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => setCurrentFolderId(child.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition ${
                            currentFolderId === child.id
                              ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Folder className="h-3 w-3 shrink-0" />
                          <span className="truncate">{child.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main Explorer Area */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {isDraggingLocalFiles && (
          <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-950/80">
            <p className="font-display text-sm font-semibold text-blue-700 dark:text-blue-300">
              Drop files to upload directly to Google Drive
            </p>
          </div>
        )}

        {/* Top Explorer Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          {/* Breadcrumbs */}
          <div className="flex min-w-0 items-center gap-1 text-sm">
            {mode === 'drive' ? (
              breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(crumb.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverFolderId(crumb.id);
                    }}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => handleDropOnFolder(e, crumb.id)}
                    className={`truncate rounded-lg px-2 py-1 text-xs font-medium transition ${
                      idx === breadcrumbs.length - 1
                        ? 'text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    } ${dragOverFolderId === crumb.id ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))
            ) : (
              <span className="font-display text-sm font-semibold capitalize text-slate-900 dark:text-slate-100">
                {mode === 'favorites'
                  ? 'Favorites'
                  : mode === 'recent'
                    ? 'Recent Files'
                    : 'Trash'}
              </span>
            )}
          </div>

          {/* Search + Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Drive ( / )"
                className="w-44 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs focus:border-blue-500 focus:bg-white focus:outline-none sm:w-56 dark:border-slate-700 dark:bg-slate-900 dark:focus:bg-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium ${
                showFilters
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </button>

            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Grid View"
                className={`rounded-lg p-1.5 ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                <Grid2x2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="List View"
                className={`rounded-lg p-1.5 ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('compact')}
                title="Compact View"
                className={`rounded-lg p-1.5 ${
                  viewMode === 'compact'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
              </button>
            </div>

            {mode === 'drive' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openNewAppWindow({
                      appId: 'sqlite',
                      title: 'database.sqlite',
                      targetFolderId: currentFolderId,
                    })
                  }
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Database className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">New SQLite DB</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewFolderOpen(true)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New Folder</span>
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload</span>
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleUploadFiles(e.target.files);
                  }}
                />
              </>
            )}

            <button
              type="button"
              onClick={loadFiles}
              title="Refresh"
              className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Advanced Filter Bar */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/40">
            <select
              value={mimeFilter}
              onChange={(e) => setMimeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">All Types</option>
              <option value="folders">Folders</option>
              <option value="documents">Documents</option>
              <option value="pdfs">PDFs</option>
              <option value="images">Images</option>
              <option value="archives">Archives (.zip)</option>
              <option value="diagrams">Diagrams</option>
              <option value="databases">SQLite DBs (.sqlite, .db)</option>
            </select>

            <input
              value={extensionFilter}
              onChange={(e) => setExtensionFilter(e.target.value)}
              placeholder="Extension (e.g. .md)"
              className="w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            />

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Any Date</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>

            <select
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Any Size</option>
              <option value="small">&lt; 1 MB</option>
              <option value="medium">1 MB – 10 MB</option>
              <option value="large">&gt; 10 MB</option>
            </select>

            <select
              value={orderBy}
              onChange={(e) => setOrderBy(e.target.value as any)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="folder,name">Sort: Folders + Name</option>
              <option value="name">Sort: Name (A–Z)</option>
              <option value="modifiedTime desc">Sort: Modified (Newest)</option>
              <option value="quotaBytesUsed desc">Sort: Size (Largest)</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setMimeFilter('');
                setExtensionFilter('');
                setDateFilter('');
                setSizeFilter('');
                setSearch('');
              }}
              className="ml-auto text-blue-600 hover:underline dark:text-blue-400"
            >
              Reset
            </button>
          </div>
        )}

        {/* Bulk Action Bar */}
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-blue-50/80 px-4 py-2 text-xs dark:border-blue-900/60 dark:bg-blue-950/40">
            <div className="flex items-center gap-2 font-medium text-blue-800 dark:text-blue-200">
              <span>{selectedFiles.length} selected</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {mode === 'trash' ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmMutationAction({
                        title: `Restore ${selectedFiles.length} item(s)?`,
                        description: 'Restore selected files from Trash back to Google Drive.',
                        label: 'Restore',
                        run: async () => {
                          for (const f of selectedFiles) await storageProvider.restoreFile(f.id);
                          toast.success('Restored selected items');
                          setSelectedIds(new Set());
                          triggerExplorerRefresh();
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 shadow-xs dark:bg-slate-900 dark:text-slate-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPermDeleteTargets(selectedFiles)}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 font-medium text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Forever
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      selectedFiles.forEach((f) => handleDownloadFile(f));
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 shadow-xs dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openNewAppWindow({
                        appId: 'archive',
                        title: `Create ZIP (${selectedFiles.length})`,
                        extraFileIds: selectedFiles.map((f) => f.id),
                        targetFolderId: currentFolderId,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 shadow-xs dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Archive className="h-3.5 w-3.5" /> Create ZIP
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoveTargets(selectedFiles);
                      setMoveDestId('root');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 shadow-xs dark:bg-slate-900 dark:text-slate-200"
                  >
                    <FolderInput className="h-3.5 w-3.5" /> Move
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkRenameOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 shadow-xs dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Bulk Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmTrashTargets(selectedFiles)}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 font-medium text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Trash
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* File Viewport */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40"
                />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <Folder className="h-10 w-10 text-slate-300 dark:text-slate-700" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                No files match this view
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Upload files, drop items here, or adjust your active filters.
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => {
                const isSelected = selectedIds.has(file.id);
                const meta = metadataMap.get(file.id);
                return (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={(e) => {
                      const ids = isSelected ? Array.from(selectedIds) : [file.id];
                      e.dataTransfer.setData('application/x-driveos-file-ids', JSON.stringify(ids));
                    }}
                    onDragOver={(e) => {
                      if (file.isFolder) {
                        e.preventDefault();
                        setDragOverFolderId(file.id);
                      }
                    }}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => file.isFolder && handleDropOnFolder(e, file.id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) toggleSelect(file.id, true);
                      else setInspectorFile(file);
                    }}
                    onDoubleClick={() => openFileWithApp(file)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openContextForFile(file, e.clientX, e.clientY);
                    }}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      longPressTimerRef.current = window.setTimeout(() => {
                        openContextForFile(file, touch.clientX, touch.clientY, true);
                      }, 520);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    }}
                    className={`group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-4 transition ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#14171F] dark:hover:border-slate-700'
                    } ${dragOverFolderId === file.id ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(file.id, true);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-blue-600" />
                        ) : (
                          <FileTypeIcon file={file} className="h-5 w-5" />
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        {meta?.isFavorite && (
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            openContextForFile(file, rect.left, rect.bottom + 4);
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <p className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {file.name}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                        <span>{file.isFolder ? 'Folder' : formatBytes(file.size)}</span>
                        <span>·</span>
                        <span>{formatRelativeDate(file.modifiedTime)}</span>
                      </p>
                      {meta?.tags && meta.tags.length > 0 && (
                        <p className="mt-1 truncate text-[11px] text-blue-600 dark:text-blue-400">
                          {meta.tags.join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-[#14171F]">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedIds(
                          selectedIds.size === files.length
                            ? new Set()
                            : new Set(files.map((f) => f.id))
                        )
                      }
                    >
                      {selectedIds.size === files.length && files.length > 0 ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Name</th>
                  {viewMode === 'list' && <th className="hidden px-3 py-2.5 font-medium md:table-cell">Tags</th>}
                  <th className="px-3 py-2.5 text-right font-medium">Size</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Modified</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {files.map((file) => {
                  const isSelected = selectedIds.has(file.id);
                  const meta = metadataMap.get(file.id);
                  return (
                    <tr
                      key={file.id}
                      draggable
                      onDragStart={(e) => {
                        const ids = isSelected ? Array.from(selectedIds) : [file.id];
                        e.dataTransfer.setData('application/x-driveos-file-ids', JSON.stringify(ids));
                      }}
                      onDragOver={(e) => {
                        if (file.isFolder) {
                          e.preventDefault();
                          setDragOverFolderId(file.id);
                        }
                      }}
                      onDragLeave={() => setDragOverFolderId(null)}
                      onDrop={(e) => file.isFolder && handleDropOnFolder(e, file.id)}
                      onClick={() => setInspectorFile(file)}
                      onDoubleClick={() => openFileWithApp(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openContextForFile(file, e.clientX, e.clientY);
                      }}
                      className={`cursor-pointer transition ${
                        isSelected
                          ? 'bg-blue-50/60 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      } ${dragOverFolderId === file.id ? 'ring-2 ring-blue-500' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(file.id, true);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className={viewMode === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5'}>
                        <div className="flex items-center gap-2.5">
                          <FileTypeIcon file={file} className="h-4 w-4 shrink-0" />
                          <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {file.name}
                          </span>
                          {meta?.isFavorite && (
                            <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                        </div>
                      </td>
                      {viewMode === 'list' && (
                        <td className="hidden px-3 py-2.5 text-slate-500 md:table-cell">
                          {meta?.tags?.join(' · ') || '—'}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                        {file.isFolder ? '—' : formatBytes(file.size)}
                      </td>
                      <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums text-slate-500 sm:table-cell">
                        {formatRelativeDate(file.modifiedTime)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            openContextForFile(file, rect.left, rect.bottom + 4);
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right File Details Inspector */}
      {inspectorFile && (
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 p-4 xl:flex dark:border-slate-800">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <FileTypeIcon file={inspectorFile} className="h-6 w-6" />
              <h3 className="font-display text-sm font-semibold text-slate-900 break-all dark:text-slate-100">
                {inspectorFile.name}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setInspectorFile(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {inspectorFile.thumbnailLink && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <img
                src={inspectorFile.thumbnailLink}
                alt={inspectorFile.name}
                referrerPolicy="no-referrer"
                className="h-36 w-full object-cover"
              />
            </div>
          )}

          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className="max-w-[150px] truncate font-mono text-slate-800 dark:text-slate-200">
                {inspectorFile.mimeType}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Size</span>
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {inspectorFile.isFolder ? 'Folder' : formatBytes(inspectorFile.size)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Modified</span>
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {formatRelativeDate(inspectorFile.modifiedTime)}
              </span>
            </div>
            {inspectorFile.md5Checksum && (
              <div className="flex justify-between">
                <span className="text-slate-500">MD5</span>
                <span className="max-w-[140px] truncate font-mono text-slate-800 dark:text-slate-200">
                  {inspectorFile.md5Checksum}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Open With</p>
            {getCompatibleApps(inspectorFile).map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => openFileWithApp(inspectorFile, app.id)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span>{app.label}</span>
                <Eye className="h-3.5 w-3.5 text-slate-400" />
              </button>
            ))}
          </div>

          {/* Custom Tags */}
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Tag className="h-3.5 w-3.5" />
              Custom Tags
            </p>
            <div className="mt-2 flex gap-1.5">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    const existing = metadataMap.get(inspectorFile.id)?.tags || [];
                    if (!existing.includes(tagDraft.trim())) {
                      updateTags(inspectorFile, [...existing, tagDraft.trim()]);
                    }
                    setTagDraft('');
                  }
                }}
                placeholder="Add tag + Enter"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => {
                  if (!tagDraft.trim()) return;
                  const existing = metadataMap.get(inspectorFile.id)?.tags || [];
                  if (!existing.includes(tagDraft.trim())) {
                    updateTags(inspectorFile, [...existing, tagDraft.trim()]);
                  }
                  setTagDraft('');
                }}
                className="rounded-lg bg-slate-900 px-2 py-1 text-white dark:bg-slate-100 dark:text-slate-900"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              {(metadataMap.get(inspectorFile.id)?.tags || []).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const existing = metadataMap.get(inspectorFile.id)?.tags || [];
                    updateTags(
                      inspectorFile,
                      existing.filter((x) => x !== t)
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 hover:border-red-300 hover:text-red-600 dark:border-slate-700"
                >
                  <span>{t}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Context Menu / Mobile Long-Press Action Sheet */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={
            contextMenu.mobileSheet
              ? undefined
              : { left: contextMenu.x, top: contextMenu.y }
          }
          className={
            contextMenu.mobileSheet
              ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-[#14171F]'
              : 'fixed z-50 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-[#14171F]'
          }
        >
          {contextMenu.mobileSheet && (
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
          )}
          <p className="truncate px-2.5 py-1.5 text-xs font-semibold text-slate-500">
            {contextMenu.file.name}
          </p>

          {getCompatibleApps(contextMenu.file).map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => {
                const f = contextMenu.file;
                setContextMenu(null);
                openFileWithApp(f, app.id);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Eye className="h-3.5 w-3.5 text-blue-600" />
              <span>Open with {app.label}</span>
            </button>
          ))}

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              toggleFavorite(f);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Star className="h-3.5 w-3.5" />
            <span>{metadataMap.get(contextMenu.file.id)?.isFavorite ? 'Remove Favorite' : 'Add to Favorites'}</span>
          </button>

          {contextMenu.file.isFolder && (
            <button
              type="button"
              onClick={() => {
                const f = contextMenu.file;
                setContextMenu(null);
                togglePin(f);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Pin className="h-3.5 w-3.5" />
              <span>{metadataMap.get(contextMenu.file.id)?.isPinned ? 'Unpin Folder' : 'Pin Folder'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              openNewAppWindow({
                appId: 'archive',
                title: `Create ZIP: ${f.name}`,
                extraFileIds: [f.id],
                targetFolderId: currentFolderId,
              });
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Create ZIP</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              handleDownloadFile(f);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              setRenameTarget(f);
              setRenameValue(f.name);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>Rename</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              setMoveTargets([f]);
              setMoveDestId('root');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FolderInput className="h-3.5 w-3.5" />
            <span>Move</span>
          </button>

          {!contextMenu.file.isFolder && (
            <button
              type="button"
              onClick={() => {
                const f = contextMenu.file;
                setContextMenu(null);
                setConfirmMutationAction({
                  title: `Copy "${f.name}"?`,
                  description: 'Create a duplicate copy of this file in the current Google Drive folder.',
                  label: 'Create Copy',
                  run: async () => {
                    await storageProvider.copyFile(f.id, `Copy of ${f.name}`, currentFolderId);
                    toast.success('File copied');
                    triggerExplorerRefresh();
                  },
                });
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Make a Copy</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              setInspectorFile(f);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Info className="h-3.5 w-3.5" />
            <span>Details &amp; Tags</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          <button
            type="button"
            onClick={() => {
              const f = contextMenu.file;
              setContextMenu(null);
              if (mode === 'trash') setConfirmPermDeleteTargets([f]);
              else setConfirmTrashTargets([f]);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{mode === 'trash' ? 'Delete Permanently' : 'Move to Trash'}</span>
          </button>
        </div>
      )}

      {/* New Folder Dialog */}
      <Dialog.Root open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold">New Folder</Dialog.Title>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              placeholder="Folder name"
              className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white"
              >
                Create
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Rename Dialog */}
      <Dialog.Root open={Boolean(renameTarget)} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold">Rename Item</Dialog.Title>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!renameTarget || !renameValue.trim()) return;
                  await storageProvider.renameFile(renameTarget.id, renameValue.trim());
                  toast.success(`Renamed to "${renameValue.trim()}"`);
                  setRenameTarget(null);
                  triggerExplorerRefresh();
                }}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white"
              >
                Confirm Rename
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Move Dialog */}
      <Dialog.Root open={Boolean(moveTargets)} onOpenChange={(o) => !o && setMoveTargets(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold">
              Move {moveTargets?.length} Item(s)
            </Dialog.Title>
            <select
              value={moveDestId}
              onChange={(e) => setMoveDestId(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="root">My Drive (Root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveTargets(null)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!moveTargets) return;
                  for (const f of moveTargets) {
                    await storageProvider.moveFile(f.id, f.parents || [], moveDestId);
                  }
                  toast.success(`Moved ${moveTargets.length} item(s)`);
                  setMoveTargets(null);
                  setSelectedIds(new Set());
                  triggerExplorerRefresh();
                }}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white"
              >
                Confirm Move
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Bulk Rename Dialog */}
      <Dialog.Root open={bulkRenameOpen} onOpenChange={setBulkRenameOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#14171F]">
            <Dialog.Title className="font-display text-base font-semibold">
              Bulk Rename ({selectedFiles.length} items)
            </Dialog.Title>
            <div className="mt-4 space-y-3">
              <input
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                placeholder="Prefix (optional)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              <input
                value={bulkSuffix}
                onChange={(e) => setBulkSuffix(e.target.value)}
                placeholder="Suffix before extension (optional)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkRenameOpen(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  for (const f of selectedFiles) {
                    const ext = getFileExtension(f.name);
                    const base = ext ? f.name.slice(0, -ext.length) : f.name;
                    const nextName = `${bulkPrefix}${base}${bulkSuffix}${ext}`;
                    await storageProvider.renameFile(f.id, nextName);
                  }
                  toast.success(`Renamed ${selectedFiles.length} item(s)`);
                  setBulkRenameOpen(false);
                  setBulkPrefix('');
                  setBulkSuffix('');
                  triggerExplorerRefresh();
                }}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white"
              >
                Apply Bulk Rename
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Trash Confirmation */}
      <ConfirmDialog
        open={Boolean(confirmTrashTargets)}
        onOpenChange={(o) => !o && setConfirmTrashTargets(null)}
        title={`Move ${confirmTrashTargets?.length || 0} item(s) to Trash?`}
        description="Selected items will be moved to Google Drive Trash. You can restore them from the Trash view."
        items={confirmTrashTargets?.map((f) => f.name)}
        confirmLabel="Move to Trash"
        destructive
        onConfirm={handleTrashConfirmed}
      />

      {/* Permanent Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(confirmPermDeleteTargets)}
        onOpenChange={(o) => !o && setConfirmPermDeleteTargets(null)}
        title={`Permanently delete ${confirmPermDeleteTargets?.length || 0} item(s)?`}
        description="This action cannot be undone. These files will be permanently removed from your Google Drive."
        items={confirmPermDeleteTargets?.map((f) => f.name)}
        confirmLabel="Delete Forever"
        destructive
        onConfirm={handlePermDeleteConfirmed}
      />

      {/* Generic Mutating Action Confirmation */}
      <ConfirmDialog
        open={Boolean(confirmMutationAction)}
        onOpenChange={(o) => !o && setConfirmMutationAction(null)}
        title={confirmMutationAction?.title || 'Confirm action'}
        description={confirmMutationAction?.description || ''}
        confirmLabel={confirmMutationAction?.label || 'Confirm'}
        onConfirm={async () => {
          const act = confirmMutationAction;
          setConfirmMutationAction(null);
          await act?.run();
        }}
      />
    </div>
  );
};
