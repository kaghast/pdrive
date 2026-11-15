import JSZip from 'jszip';
import {
  Archive,
  CheckSquare,
  Download,
  File as FileIcon,
  Folder,
  FolderUp,
  ShieldAlert,
  ShieldCheck,
  Square,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import { formatBytes } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface ArchiveEntry {
  path: string;
  type: 'directory' | 'file';
  uncompressedSize: number;
  compressedSize: number;
  lastModified: string | null;
}

interface ArchiveManagerProps {
  file?: CloudFile;
  initialFileIdsToCompress?: string[];
  targetFolderId?: string;
}

export const ArchiveManager: React.FC<ArchiveManagerProps> = ({
  file,
  initialFileIdsToCompress,
  targetFolderId,
}) => {
  const { storageProvider, triggerExplorerRefresh } = useDriveOS();
  const [loading, setLoading] = useState(Boolean(file));
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [summary, setSummary] = useState<{
    entryCount: number;
    totalUncompressed: number;
    totalCompressed: number;
    compressionRatio: number;
    zipBombWarning: boolean;
  } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<CloudFile[]>([]);
  const [extractDestId, setExtractDestId] = useState(targetFolderId || 'root');
  const [extracting, setExtracting] = useState(false);
  const [confirmExtractOpen, setConfirmExtractOpen] = useState(false);

  // Create ZIP state
  const [zipName, setZipName] = useState('Archive.zip');
  const [creatingZip, setCreatingZip] = useState(false);

  useEffect(() => {
    storageProvider.listAllFolders().then(setFolders).catch(() => {});
  }, [storageProvider]);

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    apiFetch<{ entries: ArchiveEntry[]; summary: any }>('/api/archive/inspect', {
      method: 'POST',
      body: JSON.stringify({ fileId: file.id }),
    })
      .then((data) => {
        if (active) {
          setEntries(data.entries || []);
          setSummary(data.summary || null);
        }
      })
      .catch((err) => toast.error(err.message || 'Failed to inspect archive'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const toggleEntry = (p: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const handleDownloadArchive = async () => {
    if (!file) return;
    const toastId = toast.loading('Downloading archive...');
    try {
      const blob = await storageProvider.downloadBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Download failed');
    }
  };

  const handleDownloadSingleEntry = async (entryPath: string) => {
    if (!file) return;
    const toastId = toast.loading(`Extracting "${entryPath}"...`);
    try {
      const blob = await storageProvider.downloadBlob(file.id);
      const zip = await JSZip.loadAsync(blob);
      const target = zip.file(entryPath);
      if (!target) throw new Error('Entry not found in archive');
      const extractedBlob = await target.async('blob');
      const url = URL.createObjectURL(extractedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entryPath.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Failed to extract file');
    }
  };

  const handleExtractToDrive = async () => {
    if (!file) return;
    setExtracting(true);
    try {
      const selected = Array.from(selectedPaths);
      const res = await apiFetch<{ uploadedCount: number }>('/api/archive/extract', {
        method: 'POST',
        body: JSON.stringify({
          fileId: file.id,
          destinationFolderId: extractDestId,
          selectedPaths: selected.length > 0 ? selected : undefined,
        }),
      });
      triggerExplorerRefresh();
      toast.success(`Extracted ${res.uploadedCount} file(s) directly to Google Drive`);
    } catch (err: any) {
      toast.error(err.message || 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const handleCreateZip = async () => {
    if (!initialFileIdsToCompress || initialFileIdsToCompress.length === 0) return;
    setCreatingZip(true);
    try {
      const res = await apiFetch<{ file: CloudFile; fileCount: number }>('/api/archive/create', {
        method: 'POST',
        body: JSON.stringify({
          fileIds: initialFileIdsToCompress,
          archiveName: zipName,
          destinationFolderId: extractDestId,
        }),
      });
      triggerExplorerRefresh();
      toast.success(`Created "${res.file.name}" (${res.fileCount} files) in Google Drive`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create archive');
    } finally {
      setCreatingZip(false);
    }
  };

  if (!file && initialFileIdsToCompress && initialFileIdsToCompress.length > 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Archive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Create ZIP Archive
            </h2>
            <p className="text-xs text-slate-500">
              Compressing {initialFileIdsToCompress.length} selected item(s) while preserving folder hierarchy.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Archive Filename
            </label>
            <input
              value={zipName}
              onChange={(e) => setZipName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Destination Folder in Google Drive
            </label>
            <select
              value={extractDestId}
              onChange={(e) => setExtractDestId(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="root">My Drive (Root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={creatingZip}
            onClick={handleCreateZip}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {creatingZip ? 'Generating & Uploading ZIP...' : 'Create ZIP in Google Drive'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {file?.name || 'Archive Manager'}
          </h2>
          {summary && (
            <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
              <span>{summary.entryCount} entries</span>
              <span>·</span>
              <span>Compressed {formatBytes(summary.totalCompressed)}</span>
              <span>·</span>
              <span>Uncompressed {formatBytes(summary.totalUncompressed)}</span>
              <span>·</span>
              <span>Ratio {summary.compressionRatio}x</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={extractDestId}
            onChange={(e) => setExtractDestId(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="root">Extract to: My Drive</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                Extract to: {f.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={extracting || loading}
            onClick={() => setConfirmExtractOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <FolderUp className="h-3.5 w-3.5" />
            {selectedPaths.size > 0
              ? `Extract Selected (${selectedPaths.size})`
              : 'Extract All to Drive'}
          </button>

          <button
            type="button"
            onClick={handleDownloadArchive}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Download ZIP
          </button>
        </div>
      </div>

      {summary && (
        <div
          className={`flex items-center gap-2 border-b px-5 py-2 text-xs ${
            summary.zipBombWarning
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
              : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400'
          }`}
        >
          {summary.zipBombWarning ? (
            <>
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                Warning: High compression ratio or excessive uncompressed size detected. Server-side extraction limits are enforced.
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>Path-traversal &amp; ZIP-bomb safety verification passed.</span>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Inspecting archive contents...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Archive is empty.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              <tr>
                <th className="w-10 px-4 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Path</th>
                <th className="px-3 py-2.5 text-right font-medium">Uncompressed</th>
                <th className="px-3 py-2.5 text-right font-medium">Compressed</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {entries.map((entry) => {
                const isSelected = selectedPaths.has(entry.path);
                return (
                  <tr
                    key={entry.path}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2">
                      {entry.type === 'file' && (
                        <button
                          type="button"
                          onClick={() => toggleEntry(entry.path)}
                          className="text-slate-400 hover:text-blue-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                      <div className="flex items-center gap-2">
                        {entry.type === 'directory' ? (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        ) : (
                          <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                        <span className="truncate">{entry.path}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                      {entry.type === 'directory' ? '—' : formatBytes(entry.uncompressedSize)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                      {entry.type === 'directory' ? '—' : formatBytes(entry.compressedSize)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {entry.type === 'file' && (
                        <button
                          type="button"
                          onClick={() => handleDownloadSingleEntry(entry.path)}
                          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Download
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmExtractOpen}
        onOpenChange={setConfirmExtractOpen}
        title="Extract archive to Google Drive?"
        description={
          selectedPaths.size > 0
            ? `This will upload ${selectedPaths.size} selected entry/entries into the chosen Google Drive folder.`
            : `This will extract and upload all files from "${file?.name}" into the chosen Google Drive folder while preserving directory structure.`
        }
        confirmLabel="Extract & Upload"
        loading={extracting}
        onConfirm={async () => {
          setConfirmExtractOpen(false);
          await handleExtractToDrive();
        }}
      />
    </div>
  );
};
