import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import {
  Download,
  FileDown,
  Maximize2,
  Minimize2,
  Save,
  Sparkles,
} from 'lucide-react';
import mermaid from 'mermaid';
import { PDFDocument } from 'pdf-lib';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface DiagramStudioProps {
  mode: 'excalidraw' | 'drawio' | 'mermaid';
  file?: CloudFile;
  targetFolderId?: string;
}

const DEFAULT_MERMAID = `flowchart TD
  A[Google Drive Storage] --> B{Personal Drive OS}
  B -->|Markdown| C[Markdown Studio]
  B -->|PDF| D[PDF.js & PDF-lib]
  B -->|DOCX| E[OneDrive Temp Session]
  E --> F[Word Online Editor]
  F -->|Verified Sync| A`;

const MERMAID_TEMPLATES: Record<string, string> = {
  Flowchart: DEFAULT_MERMAID,
  Sequence: `sequenceDiagram
  participant User
  participant DriveOS as Personal Drive OS
  participant OneDrive as OneDrive Temp
  participant Drive as Google Drive
  User->>DriveOS: Open DOCX in Word Online
  DriveOS->>Drive: Read authoritative file
  DriveOS->>OneDrive: Upload temporary copy
  User->>OneDrive: Edit in Word Online
  User->>DriveOS: Finish Editing & Sync
  DriveOS->>Drive: Upload & verify MD5/size
  DriveOS->>OneDrive: Delete temporary copy`,
  'Class Diagram': `classDiagram
  class StorageProvider {
    +listFiles()
    +downloadBlob()
    +uploadFile()
    +updateFileContent()
  }
  class GoogleDriveProvider {
    +getQuota()
    +exportBlob()
  }
  StorageProvider <|-- GoogleDriveProvider`,
  'ER Diagram': `erDiagram
  USERS ||--o{ EDITING_SESSIONS : starts
  USERS ||--o{ FILE_METADATA : owns
  USERS ||--o{ AUDIT_LOGS : triggers
  USERS {
    int id PK
    text uid
    text email
  }
  EDITING_SESSIONS {
    text id PK
    text drive_file_id
    text onedrive_item_id
    text status
  }`,
};

export const DiagramStudio: React.FC<DiagramStudioProps> = ({
  mode: initialMode,
  file: initialFile,
  targetFolderId,
}) => {
  const { storageProvider, settings, triggerExplorerRefresh } = useDriveOS();
  const [mode, setMode] = useState<'excalidraw' | 'drawio' | 'mermaid'>(initialMode);
  const [file, setFile] = useState<CloudFile | undefined>(initialFile);
  const [fileName, setFileName] = useState(
    initialFile?.name ||
      (initialMode === 'excalidraw'
        ? 'Diagram.excalidraw'
        : initialMode === 'drawio'
          ? 'Architecture.drawio'
          : 'Diagram.mmd')
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [autosave, setAutosave] = useState(false);

  // Excalidraw state
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [excalidrawInitialData, setExcalidrawInitialData] = useState<any>(null);
  const [excalidrawReady, setExcalidrawReady] = useState(!initialFile || initialMode !== 'excalidraw');

  // Draw.io state
  const drawioIframeRef = useRef<HTMLIFrameElement>(null);
  const [drawioXml, setDrawioXml] = useState<string>('');
  const [drawioReady, setDrawioReady] = useState(false);

  // Mermaid state
  const [mermaidCode, setMermaidCode] = useState(DEFAULT_MERMAID);
  const [mermaidSvg, setMermaidSvg] = useState('');
  const [mermaidError, setMermaidError] = useState<string | null>(null);

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Load initial file content from Drive
  useEffect(() => {
    if (!initialFile) return;
    let active = true;
    storageProvider
      .downloadText(initialFile.id)
      .then((text) => {
        if (!active) return;
        if (initialMode === 'excalidraw') {
          try {
            const parsed = JSON.parse(text);
            setExcalidrawInitialData({
              elements: parsed.elements || [],
              appState: parsed.appState || {},
              files: parsed.files || {},
            });
          } catch {
            setExcalidrawInitialData({ elements: [] });
          }
          setExcalidrawReady(true);
        } else if (initialMode === 'drawio') {
          setDrawioXml(text);
        } else {
          setMermaidCode(text);
        }
      })
      .catch((err) => {
        toast.error(err.message || 'Failed to load diagram');
        setExcalidrawReady(true);
      });
    return () => {
      active = false;
    };
  }, [initialFile, initialMode, storageProvider]);

  // Render Mermaid preview
  useEffect(() => {
    if (mode !== 'mermaid') return;
    let active = true;
    const id = `mmd-studio-${Date.now()}`;
    mermaid
      .render(id, mermaidCode)
      .then((res) => {
        if (active) {
          setMermaidSvg(res.svg);
          setMermaidError(null);
        }
      })
      .catch((err) => {
        if (active) setMermaidError(err?.message || 'Syntax error');
      });
    return () => {
      active = false;
    };
  }, [mermaidCode, mode]);

  const saveContentToDrive = useCallback(
    async (payload: string, mimeType: string, defaultExt: string, silent = false) => {
      setSaving(true);
      try {
        let saved: CloudFile;
        if (file) {
          saved = await storageProvider.updateFileContent(file.id, payload, mimeType);
        } else {
          const finalName = fileName.endsWith(defaultExt) ? fileName : `${fileName}${defaultExt}`;
          saved = await storageProvider.uploadFile(
            new Blob([payload], { type: mimeType }),
            finalName,
            mimeType,
            targetFolderId || 'root'
          );
          setFile(saved);
          setFileName(saved.name);
        }
        triggerExplorerRefresh();
        if (!silent) toast.success(`Saved "${saved.name}" to Google Drive`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to save diagram');
      } finally {
        setSaving(false);
      }
    },
    [file, fileName, storageProvider, targetFolderId, triggerExplorerRefresh]
  );

  // Draw.io postMessage protocol
  useEffect(() => {
    if (mode !== 'drawio') return;
    const onMessage = (evt: MessageEvent) => {
      if (typeof evt.data !== 'string') return;
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.event === 'init') {
        setDrawioReady(true);
        drawioIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            action: 'load',
            autosave: 1,
            xml: drawioXml || '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
          }),
          '*'
        );
      } else if (msg.event === 'save') {
        setDrawioXml(msg.xml);
        saveContentToDrive(msg.xml, 'application/xml', '.drawio', false);
      } else if (msg.event === 'autosave') {
        setDrawioXml(msg.xml);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [drawioXml, mode, saveContentToDrive]);

  // Excalidraw autosave
  useEffect(() => {
    if (!autosave || mode !== 'excalidraw' || !file || !excalidrawAPI) return;
    const interval = setInterval(() => {
      const json = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'personal-drive-os',
        elements: excalidrawAPI.getSceneElements(),
        appState: { viewBackgroundColor: excalidrawAPI.getAppState().viewBackgroundColor },
        files: excalidrawAPI.getFiles(),
      });
      saveContentToDrive(json, 'application/json', '.excalidraw', true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autosave, excalidrawAPI, file, mode, saveContentToDrive]);

  const executeSave = async () => {
    if (mode === 'excalidraw') {
      if (!excalidrawAPI) return;
      const json = JSON.stringify(
        {
          type: 'excalidraw',
          version: 2,
          source: 'personal-drive-os',
          elements: excalidrawAPI.getSceneElements(),
          appState: { viewBackgroundColor: excalidrawAPI.getAppState().viewBackgroundColor },
          files: excalidrawAPI.getFiles(),
        },
        null,
        2
      );
      await saveContentToDrive(json, 'application/json', '.excalidraw');
    } else if (mode === 'drawio') {
      if (drawioReady && drawioIframeRef.current?.contentWindow) {
        drawioIframeRef.current.contentWindow.postMessage(JSON.stringify({ action: 'save' }), '*');
      } else if (drawioXml) {
        await saveContentToDrive(drawioXml, 'application/xml', '.drawio');
      }
    } else {
      await saveContentToDrive(mermaidCode, 'text/plain', '.mmd');
    }
  };

  const handleSaveClick = () => {
    if (file) {
      setConfirmSaveOpen(true);
    } else {
      executeSave();
    }
  };

  const handleExportExcalidraw = async (format: 'png' | 'svg' | 'pdf') => {
    if (!excalidrawAPI) return;
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();
    const files = excalidrawAPI.getFiles();

    if (format === 'svg') {
      const svg = await exportToSvg({ elements, appState, files });
      const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.excalidraw$/i, '')}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const pngBlob = await exportToBlob({ elements, appState, files, mimeType: 'image/png' });
    if (format === 'png') {
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.excalidraw$/i, '')}.png`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Export as PDF via pdf-lib
    const pdfDoc = await PDFDocument.create();
    const pngBytes = await pngBlob.arrayBuffer();
    const img = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([Math.max(400, img.width), Math.max(300, img.height)]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.excalidraw$/i, '')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMermaid = async (format: 'svg' | 'png') => {
    if (!mermaidSvg) return;
    if (format === 'svg') {
      const blob = new Blob([mermaidSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.mmd$/i, '')}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const svgBlob = new Blob([mermaidSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2 || 1200;
      canvas.height = img.height * 2 || 800;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${fileName.replace(/\.mmd$/i, '')}.png`;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F] ${
        fullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11rem)] min-h-[560px]'
      }`}
    >
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-44 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700"
          />

          {!initialFile && (
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
              {(['excalidraw', 'drawio', 'mermaid'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setFileName(
                      m === 'excalidraw'
                        ? 'Diagram.excalidraw'
                        : m === 'drawio'
                          ? 'Architecture.drawio'
                          : 'Diagram.mmd'
                    );
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                    mode === m
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-500'
                  }`}
                >
                  {m === 'drawio' ? 'Draw.io' : m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {mode === 'excalidraw' && (
            <>
              <button
                type="button"
                onClick={() => handleExportExcalidraw('png')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" /> PNG
              </button>
              <button
                type="button"
                onClick={() => handleExportExcalidraw('svg')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" /> SVG
              </button>
              <button
                type="button"
                onClick={() => handleExportExcalidraw('pdf')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <FileDown className="h-3.5 w-3.5" /> PDF
              </button>
              {file && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 px-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={autosave}
                    onChange={(e) => setAutosave(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Autosave
                </label>
              )}
            </>
          )}

          {mode === 'mermaid' && (
            <>
              <select
                onChange={(e) => {
                  const tpl = MERMAID_TEMPLATES[e.target.value];
                  if (tpl) setMermaidCode(tpl);
                }}
                defaultValue=""
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="" disabled>
                  Templates...
                </option>
                {Object.keys(MERMAID_TEMPLATES).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleExportMermaid('svg')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" /> SVG
              </button>
              <button
                type="button"
                onClick={() => handleExportMermaid('png')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" /> PNG
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
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
            {saving ? 'Saving...' : 'Save to Drive'}
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="relative min-h-0 flex-1">
        {mode === 'excalidraw' && (
          <div className="h-full w-full">
            {excalidrawReady ? (
              <Excalidraw
                excalidrawAPI={(api) => setExcalidrawAPI(api)}
                initialData={excalidrawInitialData}
                theme={isDark ? 'dark' : 'light'}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading Excalidraw scene...
              </div>
            )}
          </div>
        )}

        {mode === 'drawio' && (
          <iframe
            ref={drawioIframeRef}
            title="Draw.io Diagram Editor"
            src={`https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=${isDark ? 'dark' : 'min'}`}
            className="h-full w-full border-0"
          />
        )}

        {mode === 'mermaid' && (
          <div className="grid h-full grid-cols-1 md:grid-cols-2">
            <div className="border-r border-slate-200 p-4 dark:border-slate-800">
              <textarea
                value={mermaidCode}
                onChange={(e) => setMermaidCode(e.target.value)}
                spellCheck={false}
                className="h-full w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex flex-col items-center justify-center overflow-auto bg-white p-6 dark:bg-[#0F1218]">
              {mermaidError ? (
                <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                  {mermaidError}
                </div>
              ) : (
                <div
                  className="max-w-full overflow-auto"
                  dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmSaveOpen}
        onOpenChange={setConfirmSaveOpen}
        title="Overwrite diagram in Google Drive?"
        description={`Save changes to "${fileName}" in Google Drive?`}
        confirmLabel="Save Changes"
        loading={saving}
        onConfirm={async () => {
          setConfirmSaveOpen(false);
          await executeSave();
        }}
      />
    </div>
  );
};
