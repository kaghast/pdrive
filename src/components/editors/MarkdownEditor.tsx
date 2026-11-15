import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import CodeMirror from '@uiw/react-codemirror';
import {
  Columns2,
  Copy,
  Download,
  Edit3,
  Eye,
  FileDown,
  ImagePlus,
  ListTree,
  Maximize2,
  Minimize2,
  Save,
  Search,
  X,
} from 'lucide-react';
import mermaid from 'mermaid';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });

const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
    mermaid
      .render(id, code)
      .then((res) => {
        if (active) {
          setSvg(res.svg);
          setErr(null);
        }
      })
      .catch((e) => {
        if (active) setErr(e?.message || 'Invalid Mermaid syntax');
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (err) {
    return (
      <pre className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Mermaid error: {err}
      </pre>
    );
  }
  return (
    <div
      className="my-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

interface MarkdownEditorProps {
  file?: CloudFile;
  targetFolderId?: string;
  initialContent?: string;
  onSaved?: (savedFile: CloudFile) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  file: initialFile,
  targetFolderId,
  initialContent,
  onSaved,
}) => {
  const { storageProvider, settings, triggerExplorerRefresh } = useDriveOS();
  const [file, setFile] = useState<CloudFile | undefined>(initialFile);
  const [fileName, setFileName] = useState(initialFile?.name || 'Untitled.md');
  const [content, setContent] = useState(
    initialContent ??
      `# New Document\n\nWrite Markdown with **GitHub Flavored Markdown**, tables, task lists, KaTeX math ($E = mc^2$), and Mermaid diagrams.\n\n- [x] Connected to Google Drive\n- [ ] Draft sections\n`
  );
  const [loading, setLoading] = useState(Boolean(initialFile));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'source' | 'preview'>('split');
  const [showOutline, setShowOutline] = useState(true);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (!initialFile) return;
    let active = true;
    setLoading(true);
    storageProvider
      .downloadText(initialFile.id)
      .then((text) => {
        if (active) {
          setContent(text);
          setDirty(false);
        }
      })
      .catch((err) => toast.error(err.message || 'Failed to load Markdown file'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialFile, storageProvider]);

  const performSave = useCallback(
    async (silent = false) => {
      setSaving(true);
      try {
        let saved: CloudFile;
        if (file) {
          saved = await storageProvider.updateFileContent(file.id, content, 'text/markdown');
          if (fileName !== file.name) {
            saved = await storageProvider.renameFile(file.id, fileName);
          }
        } else {
          const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
          saved = await storageProvider.uploadFile(
            new Blob([content], { type: 'text/markdown' }),
            finalName,
            'text/markdown',
            targetFolderId || 'root'
          );
          setFile(saved);
          setFileName(saved.name);
        }
        setDirty(false);
        triggerExplorerRefresh();
        onSaved?.(saved);
        if (!silent) toast.success(`Saved "${saved.name}" to Google Drive`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to save Markdown file');
      } finally {
        setSaving(false);
      }
    },
    [content, file, fileName, onSaved, storageProvider, targetFolderId, triggerExplorerRefresh]
  );

  // Autosave (only when editing an existing file and autosave toggle enabled)
  useEffect(() => {
    if (!autosave || !dirty || !file) return;
    const timer = setTimeout(() => {
      performSave(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [autosave, dirty, file, performSave]);

  const handleSaveClick = () => {
    if (file) {
      setConfirmOverwriteOpen(true);
    } else {
      performSave(false);
    }
  };

  const handleDuplicate = async () => {
    if (!file) {
      toast.info('Save the file first before duplicating.');
      return;
    }
    try {
      const copyName = file.name.replace(/(\.md)?$/i, ' (Copy).md');
      const copy = await storageProvider.copyFile(file.id, copyName, file.parents?.[0]);
      triggerExplorerRefresh();
      toast.success(`Duplicated as "${copy.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Duplicate failed');
    }
  };

  const handleRenameSubmit = async () => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    setFileName(trimmed);
    setRenaming(false);
    if (file) {
      try {
        const updated = await storageProvider.renameFile(file.id, trimmed);
        setFile(updated);
        triggerExplorerRefresh();
        toast.success(`Renamed to "${updated.name}"`);
      } catch (err: any) {
        toast.error(err.message || 'Rename failed');
      }
    }
  };

  const handleImageUpload = async (imgFile: File) => {
    const toastId = toast.loading(`Uploading "${imgFile.name}" to Google Drive...`);
    try {
      const uploaded = await storageProvider.uploadFile(
        imgFile,
        imgFile.name,
        imgFile.type || 'image/png',
        file?.parents?.[0] || targetFolderId || 'root'
      );
      toast.dismiss(toastId);
      const mdImage = `\n![${imgFile.name}](https://drive.google.com/uc?id=${uploaded.id})\n`;
      setContent((prev) => prev + mdImage);
      setDirty(true);
      toast.success(`Inserted image "${imgFile.name}"`);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Image upload failed');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const dropped = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (dropped) {
      e.preventDefault();
      handleImageUpload(dropped);
    }
  };

  const handleExportHtml = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title><style>body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;line-height:1.6;color:#0f172a}pre{background:#f1f5f9;padding:12px;border-radius:8px;overflow:auto}</style></head><body><pre style="white-space:pre-wrap;background:transparent;padding:0">${content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.md$/i, '') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      let page = pdfDoc.addPage([612, 792]);
      let y = 740;
      const margin = 52;
      const maxWidth = 508;

      const lines = content.split('\n');
      for (const rawLine of lines) {
        const isHeading = rawLine.startsWith('#');
        const clean = rawLine.replace(/^#+\s*/, '').replace(/[*_`]/g, '');
        const fontSize = isHeading ? 14 : 10.5;
        const activeFont = isHeading ? boldFont : font;
        const words = clean.split(' ');
        let current = '';

        for (const w of words) {
          const test = current ? `${current} ${w}` : w;
          if (activeFont.widthOfTextAtSize(test, fontSize) > maxWidth) {
            if (y < 60) {
              page = pdfDoc.addPage([612, 792]);
              y = 740;
            }
            page.drawText(current, { x: margin, y, size: fontSize, font: activeFont, color: rgb(0.08, 0.1, 0.14) });
            y -= fontSize + 5;
            current = w;
          } else {
            current = test;
          }
        }
        if (y < 60) {
          page = pdfDoc.addPage([612, 792]);
          y = 740;
        }
        if (current) {
          page.drawText(current, { x: margin, y, size: fontSize, font: activeFont, color: rgb(0.08, 0.1, 0.14) });
        }
        y -= fontSize + 6;
      }

      const bytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.md$/i, '') + '.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported Markdown as PDF');
    } catch (err: any) {
      toast.error(err.message || 'PDF export failed');
    }
  };

  const handleReplaceAll = () => {
    if (!findQuery) return;
    const next = content.split(findQuery).join(replaceText);
    if (next !== content) {
      setContent(next);
      setDirty(true);
      toast.success('Replaced all matches');
    }
  };

  const headings = useMemo(() => {
    return content
      .split('\n')
      .map((line, idx) => {
        const m = /^(#{1,4})\s+(.+)$/.exec(line.trim());
        if (!m) return null;
        return { level: m[1].length, text: m[2], line: idx + 1 };
      })
      .filter(Boolean) as { level: number; text: string; line: number }[];
  }, [content]);

  const stats = useMemo(() => {
    const trimmed = content.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, chars: content.length };
  }, [content]);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F] ${
        fullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11rem)] min-h-[540px]'
      }`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                autoFocus
              />
              <button
                type="button"
                onClick={handleRenameSubmit}
                className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-lg px-2 py-1 text-xs text-slate-500"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRenameDraft(fileName);
                setRenaming(true);
              }}
              className="flex items-center gap-1.5 truncate rounded-lg px-2 py-1 text-sm font-semibold text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <span className="truncate">{fileName}</span>
              <Edit3 className="h-3.5 w-3.5 text-slate-400" />
            </button>
          )}
          <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
            {dirty ? 'Unsaved changes' : 'Synced'} · {stats.words} words · {stats.chars} chars
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('source')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                viewMode === 'source'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500'
              }`}
            >
              Source
            </button>
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
                viewMode === 'split'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Split
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
                viewMode === 'preview'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowOutline((v) => !v)}
            title="Toggle Outline"
            className={`rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
              showOutline ? 'bg-slate-100 dark:bg-slate-800' : ''
            }`}
          >
            <ListTree className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowFind((v) => !v)}
            title="Find & Replace"
            className={`rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${
              showFind ? 'bg-slate-100 dark:bg-slate-800' : ''
            }`}
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Insert Image"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageUpload(f);
            }}
          />

          <button
            type="button"
            onClick={handleDuplicate}
            title="Duplicate File"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Copy className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleExportHtml}
            title="Export HTML"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            HTML
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            title="Export PDF"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <FileDown className="h-3.5 w-3.5" />
            PDF
          </button>

          {file && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autosave}
                onChange={(e) => setAutosave(e.target.checked)}
                className="rounded border-slate-300"
              />
              Autosave
            </label>
          )}

          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title="Fullscreen"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveClick}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Find & Replace Bar */}
      {showFind && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/60">
          <input
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find text..."
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={handleReplaceAll}
            className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => setShowFind(false)}
            className="ml-auto rounded-lg p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Editor Body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Loading document from Google Drive...
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {showOutline && (
            <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-slate-200 p-3 md:block dark:border-slate-800">
              <p className="mb-2 text-xs font-semibold text-slate-500">Document Outline</p>
              {headings.length === 0 ? (
                <p className="text-xs text-slate-400">No headings yet</p>
              ) : (
                <ul className="space-y-1">
                  {headings.map((h, i) => (
                    <li
                      key={i}
                      style={{ paddingLeft: `${(h.level - 1) * 10}px` }}
                      className="truncate text-xs text-slate-600 dark:text-slate-300"
                    >
                      {h.text}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}

          {(viewMode === 'source' || viewMode === 'split') && (
            <div
              className={`min-h-0 overflow-y-auto ${
                viewMode === 'split'
                  ? 'w-full border-r border-slate-200 md:w-1/2 dark:border-slate-800'
                  : 'w-full'
              }`}
            >
              <CodeMirror
                value={content}
                height="100%"
                theme={isDark ? 'dark' : 'light'}
                extensions={[markdown({ codeLanguages: languages })]}
                onChange={(val) => {
                  setContent(val);
                  setDirty(true);
                }}
                className="h-full text-sm"
              />
            </div>
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div
              className={`min-h-0 overflow-y-auto p-6 ${
                viewMode === 'split' ? 'hidden w-1/2 md:block' : 'w-full'
              }`}
            >
              <article className="prose prose-slate max-w-none dark:prose-invert prose-headings:font-display prose-pre:rounded-xl prose-pre:bg-slate-900 prose-pre:p-4 prose-pre:text-slate-100">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const codeStr = String(children).replace(/\n$/, '');
                      if (match?.[1] === 'mermaid') {
                        return <MermaidBlock code={codeStr} />;
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {content}
                </ReactMarkdown>
              </article>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOverwriteOpen}
        onOpenChange={setConfirmOverwriteOpen}
        title="Save changes to Google Drive?"
        description={`This will update the contents of "${fileName}" directly in Google Drive.`}
        confirmLabel="Save Changes"
        loading={saving}
        onConfirm={async () => {
          setConfirmOverwriteOpen(false);
          await performSave(false);
        }}
      />
    </div>
  );
};
