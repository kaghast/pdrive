import { javascript } from '@codemirror/lang-javascript';
import CodeMirror from '@uiw/react-codemirror';
import { Download, RotateCw, Save, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { formatBytes } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export const CodeFileEditor: React.FC<{ file: CloudFile }> = ({ file }) => {
  const { storageProvider, settings, triggerExplorerRefresh } = useDriveOS();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    let active = true;
    setLoading(true);
    storageProvider
      .downloadText(file.id)
      .then((text) => {
        if (active) {
          setContent(text);
          setDirty(false);
        }
      })
      .catch((err) => toast.error(err.message || 'Failed to read file'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file.id, storageProvider]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await storageProvider.updateFileContent(file.id, content, file.mimeType || 'text/plain');
      setDirty(false);
      triggerExplorerRefresh();
      toast.success(`Saved "${file.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            {file.name}
          </h3>
          <p className="text-xs text-slate-500">
            {file.mimeType} · {dirty ? 'Modified' : 'Saved'}
          </p>
        </div>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Loading file...
          </div>
        ) : (
          <CodeMirror
            value={content}
            height="100%"
            theme={isDark ? 'dark' : 'light'}
            extensions={[javascript({ typescript: true, jsx: true })]}
            onChange={(val) => {
              setContent(val);
              setDirty(true);
            }}
          />
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Overwrite file in Google Drive?"
        description={`Update "${file.name}" in Google Drive with your edited content?`}
        confirmLabel="Save Changes"
        loading={saving}
        onConfirm={async () => {
          setConfirmOpen(false);
          await handleSave();
        }}
      />
    </div>
  );
};

export const ImageViewer: React.FC<{ file: CloudFile }> = ({ file }) => {
  const { storageProvider } = useDriveOS();
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    storageProvider
      .downloadBlob(file.id)
      .then((blob) => {
        if (!active) return;
        objUrl = URL.createObjectURL(blob);
        setSrcUrl(objUrl);
      })
      .catch((err) => toast.error(err.message || 'Failed to load image'));
    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [file.id, storageProvider]);

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            {file.name}
          </h3>
          <p className="text-xs text-slate-500 tabular-nums">
            {file.mimeType} · {formatBytes(file.size)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          {srcUrl && (
            <a
              href={srcUrl}
              download={file.name}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-100/70 p-6 dark:bg-[#0B0D11]">
        {srcUrl ? (
          <img
            src={srcUrl}
            alt={file.name}
            referrerPolicy="no-referrer"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            className="max-h-full max-w-full rounded-lg object-contain transition-transform duration-150"
          />
        ) : (
          <span className="text-sm text-slate-500">Loading image...</span>
        )}
      </div>
    </div>
  );
};
