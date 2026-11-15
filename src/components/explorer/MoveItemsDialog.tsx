import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Pin,
  Search,
  Star,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileMetadataRecord } from '../../contexts/DriveOSContext';
import { CloudFile, StorageProvider } from '../../providers/StorageProvider';

interface MoveItemsDialogProps {
  open: boolean;
  items: CloudFile[];
  folders: CloudFile[];
  initialFolderId?: string;
  metadataList: FileMetadataRecord[];
  storageProvider: StorageProvider;
  onClose: () => void;
  onMoved: () => void;
}

export const MoveItemsDialog: React.FC<MoveItemsDialogProps> = ({
  open,
  items,
  folders: initialFolders,
  initialFolderId = 'root',
  metadataList,
  storageProvider,
  onClose,
  onMoved,
}) => {
  const [folders, setFolders] = useState<CloudFile[]>(initialFolders);
  const [browseFolderId, setBrowseFolderId] = useState<string>(initialFolderId || 'root');
  const [selectedFolderId, setSelectedFolderId] = useState<string>(initialFolderId || 'root');
  const [search, setSearch] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moving, setMoving] = useState(false);

  // Sync folders prop & reset navigation when dialog opens
  useEffect(() => {
    setFolders(initialFolders);
  }, [initialFolders]);

  useEffect(() => {
    if (!open) return;
    const startId =
      initialFolderId &&
      (initialFolderId === 'root' || initialFolders.some((f) => f.id === initialFolderId))
        ? initialFolderId
        : 'root';
    setBrowseFolderId(startId);
    setSelectedFolderId(startId);
    setSearch('');
    setNewFolderMode(false);
    setNewFolderName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFolderId]);

  const folderMap = useMemo(() => {
    const m = new Map<string, CloudFile>();
    for (const f of folders) {
      m.set(f.id, f);
    }
    return m;
  }, [folders]);

  // Compute forbidden destination IDs (cannot move a folder into itself or its descendants)
  const forbiddenIds = useMemo(() => {
    const movingFolderIds = new Set(items.filter((i) => i.isFolder).map((i) => i.id));
    if (movingFolderIds.size === 0) return new Set<string>();

    const childrenByParent = new Map<string, string[]>();
    for (const f of folders) {
      for (const p of f.parents || []) {
        if (!childrenByParent.has(p)) childrenByParent.set(p, []);
        childrenByParent.get(p)!.push(f.id);
      }
    }

    const forbidden = new Set<string>();
    const queue = Array.from(movingFolderIds);
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (forbidden.has(id)) continue;
      forbidden.add(id);
      const kids = childrenByParent.get(id) || [];
      for (const k of kids) queue.push(k);
    }
    return forbidden;
  }, [folders, items]);

  // Helper to get breadcrumb trail & full readable path for any folder
  const getFolderTrail = (folderId: string): { id: string; name: string }[] => {
    if (folderId === 'root') return [{ id: 'root', name: 'My Drive' }];
    const trail: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = folderId;
    while (cursor && cursor !== 'root' && !seen.has(cursor) && trail.length < 15) {
      seen.add(cursor);
      const node = folderMap.get(cursor);
      if (!node) break;
      trail.unshift({ id: node.id, name: node.name });
      cursor = node.parents?.[0];
    }
    return [{ id: 'root', name: 'My Drive' }, ...trail];
  };

  const getFolderPathLabel = (folderId: string) =>
    getFolderTrail(folderId)
      .map((t) => t.name)
      .join(' / ');

  const breadcrumbs = useMemo(() => getFolderTrail(browseFolderId), [browseFolderId, folderMap]);

  // Children count map for showing subfolder indicators
  const subfolderCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of folders) {
      const pid = f.parents?.[0] || 'root';
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    return counts;
  }, [folders]);

  // Current visible folders (either search across all subfolders or children of browseFolderId)
  const visibleFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      return folders
        .filter((f) => f.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return folders
      .filter((f) => {
        const parents = f.parents || [];
        if (browseFolderId === 'root') {
          return parents.includes('root') || parents.length === 0;
        }
        return parents.includes(browseFolderId);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [browseFolderId, folders, search]);

  // Quick shortcuts: Starred or Pinned folders
  const shortcutFolders = useMemo(() => {
    const metaIds = new Set(
      metadataList
        .filter(
          (m) =>
            (m.isFavorite || m.isPinned) &&
            m.mimeType === 'application/vnd.google-apps.folder'
        )
        .map((m) => m.fileId)
    );
    return folders.filter((f) => metaIds.has(f.id) && !forbiddenIds.has(f.id)).slice(0, 6);
  }, [folders, forbiddenIds, metadataList]);

  const enterFolder = (folderId: string) => {
    if (forbiddenIds.has(folderId)) return;
    setSearch('');
    setBrowseFolderId(folderId);
    setSelectedFolderId(folderId);
    setNewFolderMode(false);
  };

  const goUpOneLevel = () => {
    if (breadcrumbs.length <= 1) return;
    const parent = breadcrumbs[breadcrumbs.length - 2];
    enterFolder(parent.id);
  };

  const handleCreateSubfolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const created = await storageProvider.createFolder(name, browseFolderId);
      const normalized: CloudFile = {
        ...created,
        parents: created.parents?.length ? created.parents : [browseFolderId],
      };
      setFolders((prev) => [...prev, normalized]);
      setSelectedFolderId(normalized.id);
      setNewFolderName('');
      setNewFolderMode(false);
      toast.success(`Created folder "${name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleConfirmMove = async () => {
    if (items.length === 0 || forbiddenIds.has(selectedFolderId)) return;
    setMoving(true);
    try {
      let movedCount = 0;
      for (const item of items) {
        const currentParents = item.parents || [];
        await storageProvider.moveFile(item.id, currentParents, selectedFolderId);
        movedCount++;
      }
      const destLabel =
        selectedFolderId === 'root'
          ? 'My Drive'
          : folderMap.get(selectedFolderId)?.name || 'destination folder';
      toast.success(`Moved ${movedCount} item(s) to "${destLabel}"`);
      onMoved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to move item(s)');
    } finally {
      setMoving(false);
    }
  };

  const destinationLabel = getFolderPathLabel(selectedFolderId);
  const destinationDisabled = forbiddenIds.has(selectedFolderId);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !moving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#14171F]">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 font-display text-base font-semibold text-slate-900 dark:text-white">
                <FolderInput className="h-4.5 w-4.5 text-blue-600" />
                <span>
                  Move {items.length === 1 ? `"${items[0].name}"` : `${items.length} Items`}
                </span>
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                Click a folder to select it, or double-click / use the arrow to browse subfolders.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={moving}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Search + Quick Shortcuts */}
          <div className="space-y-2.5 border-b border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center gap-2">
              <div className="relative flex flex-1 items-center">
                <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search all folders & subfolders..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setNewFolderMode((v) => !v)}
                title="Create new subfolder here"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <FolderPlus className="h-3.5 w-3.5 text-blue-600" />
                <span>New Folder</span>
              </button>
            </div>

            {/* New Subfolder Inline Creator */}
            {newFolderMode && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-2 dark:border-blue-900/60 dark:bg-blue-950/30">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateSubfolder();
                    }
                  }}
                  placeholder={`New subfolder in ${breadcrumbs[breadcrumbs.length - 1]?.name}...`}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                />
                <button
                  type="button"
                  disabled={creatingFolder || !newFolderName.trim()}
                  onClick={handleCreateSubfolder}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingFolder ? 'Creating...' : 'Create'}
                </button>
              </div>
            )}

            {/* Quick Jump Chips (My Drive + Favorite/Pinned Folders) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => enterFolder('root')}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                  browseFolderId === 'root' && selectedFolderId === 'root' && !search
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <HardDrive className="h-3 w-3" />
                My Drive
              </button>
              {shortcutFolders.map((sf) => {
                const isPinned = metadataList.find((m) => m.fileId === sf.id)?.isPinned;
                return (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => enterFolder(sf.id)}
                    className={`inline-flex max-w-[150px] items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                      selectedFolderId === sf.id
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {isPinned ? (
                      <Pin className="h-3 w-3 shrink-0 text-blue-500" />
                    ) : (
                      <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                    <span className="truncate">{sf.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Breadcrumb Navigation Bar (when browsing hierarchy) */}
          {!search.trim() && (
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-5 py-2 text-xs dark:border-slate-800/80">
              {breadcrumbs.length > 1 && (
                <button
                  type="button"
                  onClick={goUpOneLevel}
                  title="Up one folder"
                  className="mr-1 rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              )}
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <button
                    type="button"
                    onClick={() => enterFolder(crumb.id)}
                    className={`shrink-0 rounded-lg px-2 py-1 font-medium transition ${
                      idx === breadcrumbs.length - 1
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Folder List Viewport */}
          <div className="min-h-[220px] flex-1 space-y-1 overflow-y-auto p-3">
            {visibleFolders.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-slate-400">
                <Folder className="mb-2 h-8 w-8 opacity-40" />
                <p className="font-medium text-slate-600 dark:text-slate-300">
                  {search.trim() ? 'No matching folders found' : 'No subfolders inside this folder'}
                </p>
                {!search.trim() && (
                  <p className="mt-1">
                    You can move directly into{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {breadcrumbs[breadcrumbs.length - 1]?.name}
                    </span>{' '}
                    below or create a new subfolder.
                  </p>
                )}
              </div>
            ) : (
              visibleFolders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                const isForbidden = forbiddenIds.has(folder.id);
                const subCount = subfolderCountMap.get(folder.id) || 0;
                const pathLabel = search.trim() ? getFolderPathLabel(folder.id) : null;

                return (
                  <div
                    key={folder.id}
                    onClick={() => !isForbidden && setSelectedFolderId(folder.id)}
                    onDoubleClick={() => !isForbidden && enterFolder(folder.id)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${
                      isForbidden
                        ? 'cursor-not-allowed border-slate-100 bg-slate-50/50 opacity-50 dark:border-slate-800/50 dark:bg-slate-900/20'
                        : isSelected
                          ? 'cursor-pointer border-blue-500 bg-blue-50/80 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                          : 'cursor-pointer border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Folder
                        className={`h-4.5 w-4.5 shrink-0 ${
                          isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{folder.name}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                        </div>
                        {pathLabel && (
                          <p className="truncate text-[11px] text-slate-400">{pathLabel}</p>
                        )}
                      </div>
                    </div>

                    {isForbidden ? (
                      <span className="shrink-0 text-[10px] font-medium text-slate-400">
                        Current / Nested
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          enterFolder(folder.id);
                        }}
                        title={`Open "${folder.name}" subfolders`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {subCount > 0 && (
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {subCount}
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer: Live Destination Preview + Confirm Move */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Destination
              </p>
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                {destinationLabel}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={moving}
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={moving || destinationDisabled}
                onClick={handleConfirmMove}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <FolderInput className="h-3.5 w-3.5" />
                {moving
                  ? 'Moving...'
                  : `Move Here (${selectedFolderId === 'root' ? 'My Drive' : folderMap.get(selectedFolderId)?.name || 'Folder'})`}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
