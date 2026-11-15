import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Files,
  ImagePlus,
  Layers,
  Maximize2,
  Minimize2,
  PenTool,
  Printer,
  RotateCw,
  Save,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfStudioProps {
  file?: CloudFile;
  isGoogleExport?: boolean;
  targetFolderId?: string;
}

export const PdfStudio: React.FC<PdfStudioProps> = ({
  file: initialFile,
  isGoogleExport = false,
  targetFolderId,
}) => {
  const { storageProvider, triggerExplorerRefresh } = useDriveOS();
  const [file, setFile] = useState<CloudFile | undefined>(initialFile);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(Boolean(initialFile));
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [fitMode, setFitMode] = useState<'custom' | 'width' | 'page'>('width');
  const [fullscreen, setFullscreen] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<{ page: number; snippet: string }[]>([]);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [showTextLayer, setShowTextLayer] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState<'view' | 'pages' | 'annotate' | 'create'>('view');

  // Editor tool inputs
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [annotText, setAnnotText] = useState('Approved');
  const [annotX, setAnnotX] = useState(60);
  const [annotY, setAnnotY] = useState(720);
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  const [saveAsName, setSaveAsName] = useState(
    initialFile
      ? isGoogleExport
        ? `${initialFile.name}.pdf`
        : initialFile.name
      : 'Document.pdf'
  );
  const [folders, setFolders] = useState<CloudFile[]>([]);
  const [saveDestFolderId, setSaveDestFolderId] = useState(targetFolderId || 'root');
  const [saving, setSaving] = useState(false);
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);

  // Signature pad modal
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportContainerRef = useRef<HTMLDivElement>(null);
  const pdfJsDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    storageProvider.listAllFolders().then(setFolders).catch(() => {});
  }, [storageProvider]);

  // Load initial PDF or create a clean starter PDF if none
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!initialFile) {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        const page = doc.addPage([612, 792]);
        page.drawText('New PDF Document', { x: 56, y: 720, size: 22, font, color: rgb(0.08, 0.1, 0.16) });
        const bytes = await doc.save();
        if (active) {
          setPdfBytes(bytes);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const blob = isGoogleExport
          ? await storageProvider.exportBlob(initialFile.id, 'application/pdf')
          : await storageProvider.downloadBlob(initialFile.id);
        const arr = new Uint8Array(await blob.arrayBuffer());
        if (active) setPdfBytes(arr);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load PDF');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [initialFile, isGoogleExport, storageProvider]);

  // Parse PDF.js document + extract searchable text when bytes change
  useEffect(() => {
    if (!pdfBytes) return;
    let active = true;
    const copy = new Uint8Array(pdfBytes);
    pdfjsLib
      .getDocument({ data: copy })
      .promise.then(async (doc) => {
        if (!active) return;
        pdfJsDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage((p) => Math.min(Math.max(1, p), doc.numPages));

        const extracted: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const tc = await page.getTextContent();
          const str = tc.items.map((it: any) => it.str || '').join(' ');
          extracted.push(str);
        }
        if (active) setPageTexts(extracted);
      })
      .catch((err) => {
        console.error('PDF.js load error:', err);
        toast.error('Unable to render PDF document');
      });
    return () => {
      active = false;
    };
  }, [pdfBytes]);

  // Render active page
  const renderCurrentPage = useCallback(async () => {
    const doc = pdfJsDocRef.current;
    const canvas = mainCanvasRef.current;
    const container = viewportContainerRef.current;
    if (!doc || !canvas || currentPage < 1 || currentPage > doc.numPages) return;

    const page = await doc.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });

    let targetScale = scale;
    if (container) {
      const cw = Math.max(300, container.clientWidth - 48);
      const ch = Math.max(300, container.clientHeight - 48);
      if (fitMode === 'width') {
        targetScale = cw / unscaled.width;
      } else if (fitMode === 'page') {
        targetScale = Math.min(cw / unscaled.width, ch / unscaled.height);
      }
    }

    const viewport = page.getViewport({ scale: targetScale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }, [currentPage, fitMode, scale]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage, numPages, pdfBytes]);

  // Search within PDF
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      return;
    }
    const q = searchQuery.trim().toLowerCase();
    const matches: { page: number; snippet: string }[] = [];
    pageTexts.forEach((txt, idx) => {
      const pos = txt.toLowerCase().indexOf(q);
      if (pos !== -1) {
        const start = Math.max(0, pos - 30);
        const end = Math.min(txt.length, pos + q.length + 50);
        matches.push({ page: idx + 1, snippet: txt.slice(start, end) });
      }
    });
    setSearchMatches(matches);
  }, [pageTexts, searchQuery]);

  // Helper to mutate PDF using pdf-lib
  const mutatePdf = async (fn: (doc: PDFDocument) => Promise<void> | void, successMsg: string) => {
    if (!pdfBytes) return;
    try {
      const doc = await PDFDocument.load(pdfBytes);
      await fn(doc);
      const updated = await doc.save();
      setPdfBytes(updated);
      toast.success(successMsg);
    } catch (err: any) {
      toast.error(err.message || 'PDF operation failed');
    }
  };

  const handleRotatePage = () => {
    mutatePdf((doc) => {
      const page = doc.getPage(currentPage - 1);
      const curr = page.getRotation().angle;
      page.setRotation(degrees((curr + 90) % 360));
    }, `Rotated page ${currentPage} by 90°`);
  };

  const handleDeletePage = () => {
    if (numPages <= 1) {
      toast.error('Cannot delete the only remaining page.');
      return;
    }
    mutatePdf((doc) => {
      doc.removePage(currentPage - 1);
    }, `Deleted page ${currentPage}`);
  };

  const handleReorderPage = (direction: -1 | 1) => {
    const targetIdx = currentPage - 1 + direction;
    if (targetIdx < 0 || targetIdx >= numPages) return;
    mutatePdf(async (doc) => {
      const order = Array.from({ length: doc.getPageCount() }, (_, i) => i);
      const tmp = order[currentPage - 1];
      order[currentPage - 1] = order[targetIdx];
      order[targetIdx] = tmp;

      const fresh = await PDFDocument.create();
      const copied = await fresh.copyPages(doc, order);
      copied.forEach((p) => fresh.addPage(p));
      const nextBytes = await fresh.save();
      setPdfBytes(nextBytes);
      setCurrentPage(targetIdx + 1);
    }, `Moved page ${currentPage}`);
  };

  const handleExtractSelected = async () => {
    if (!pdfBytes || selectedPages.size === 0) {
      toast.error('Select one or more pages to extract.');
      return;
    }
    try {
      const src = await PDFDocument.load(pdfBytes);
      const fresh = await PDFDocument.create();
      const indices = Array.from(selectedPages)
        .map((p) => p - 1)
        .sort((a, b) => a - b);
      const copied = await fresh.copyPages(src, indices);
      copied.forEach((p) => fresh.addPage(p));
      const out = await fresh.save();
      const blob = new Blob([new Uint8Array(out)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Extracted-${saveAsName}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Extracted ${indices.length} page(s)`);
    } catch (err: any) {
      toast.error(err.message || 'Extract failed');
    }
  };

  const handleMergeLocalPdf = async (fileObj: File) => {
    if (!pdfBytes) return;
    try {
      const extraBytes = new Uint8Array(await fileObj.arrayBuffer());
      const mainDoc = await PDFDocument.load(pdfBytes);
      const extraDoc = await PDFDocument.load(extraBytes);
      const copied = await mainDoc.copyPages(extraDoc, extraDoc.getPageIndices());
      copied.forEach((p) => mainDoc.addPage(p));
      setPdfBytes(await mainDoc.save());
      toast.success(`Merged ${copied.length} pages from "${fileObj.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to merge PDF');
    }
  };

  const handleImagesToPdf = async (files: FileList) => {
    try {
      const doc = pdfBytes ? await PDFDocument.load(pdfBytes) : await PDFDocument.create();
      let added = 0;
      for (const f of Array.from(files)) {
        const bytes = await f.arrayBuffer();
        const img = f.type.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([Math.max(400, img.width), Math.max(400, img.height)]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        added++;
      }
      setPdfBytes(await doc.save());
      toast.success(`Added ${added} image page(s) to PDF`);
    } catch (err: any) {
      toast.error(err.message || 'Image to PDF conversion failed (supports PNG/JPG)');
    }
  };

  const handleAddAnnotation = () => {
    if (!annotText.trim()) return;
    mutatePdf(async (doc) => {
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const page = doc.getPage(currentPage - 1);
      page.drawText(annotText, {
        x: Number(annotX) || 50,
        y: Number(annotY) || 700,
        size: 14,
        font,
        color: rgb(0.14, 0.39, 0.92),
      });
    }, `Added annotation to page ${currentPage}`);
  };

  const handleAddWatermark = () => {
    if (!watermarkText.trim()) return;
    mutatePdf(async (doc) => {
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(watermarkText, {
          x: width * 0.2,
          y: height * 0.45,
          size: 42,
          font,
          color: rgb(0.55, 0.58, 0.65),
          opacity: 0.28,
          rotate: degrees(35),
        });
      }
    }, 'Added watermark to all pages');
  };

  const handleAddPageNumbers = () => {
    mutatePdf(async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      pages.forEach((page, i) => {
        const { width } = page.getSize();
        page.drawText(`${i + 1} / ${pages.length}`, {
          x: width / 2 - 16,
          y: 24,
          size: 10,
          font,
          color: rgb(0.35, 0.4, 0.48),
        });
      });
    }, 'Added page numbers');
  };

  const handleApplySignature = async () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const pngBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
    await mutatePdf(async (doc) => {
      const sigImg = await doc.embedPng(pngBytes);
      const page = doc.getPage(currentPage - 1);
      page.drawImage(sigImg, { x: 64, y: 72, width: 160, height: 60 });
    }, `Placed signature on page ${currentPage}`);
    setSigModalOpen(false);
  };

  const handleDownloadPdf = () => {
    if (!pdfBytes) return;
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = saveAsName.endsWith('.pdf') ? saveAsName : `${saveAsName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    if (!pdfBytes) return;
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
    };
  };

  const saveToDrive = async (asNewCopy: boolean) => {
    if (!pdfBytes) return;
    setSaving(true);
    try {
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const finalName = saveAsName.endsWith('.pdf') ? saveAsName : `${saveAsName}.pdf`;
      let saved: CloudFile;

      // Never overwrite original Google Docs / Slides when exporting!
      if (file && !isGoogleExport && !asNewCopy) {
        saved = await storageProvider.updateFileContent(file.id, blob, 'application/pdf');
      } else {
        saved = await storageProvider.uploadFile(blob, finalName, 'application/pdf', saveDestFolderId);
        if (!isGoogleExport) setFile(saved);
      }
      triggerExplorerRefresh();
      toast.success(`Saved "${saved.name}" to Google Drive`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save PDF to Google Drive');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F] ${
        fullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11rem)] min-h-[560px]'
      }`}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          <input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            className="w-44 truncate rounded-lg border border-transparent px-2 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700"
          />
          {isGoogleExport && (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Exported from Google Workspace (Original preserved)
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
            {(
              [
                ['view', 'Viewer'],
                ['pages', 'Pages'],
                ['annotate', 'Annotate'],
                ['create', 'Merge & Images'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setActiveToolTab(k)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  activeToolTab === k
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handlePrintPdf}
            title="Print PDF"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Printer className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            title="Download PDF"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <select
            value={saveDestFolderId}
            onChange={(e) => setSaveDestFolderId(e.target.value)}
            className="hidden rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:block dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="root">Folder: My Drive</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={saving || !pdfBytes}
            onClick={() => {
              if (file && !isGoogleExport) {
                setConfirmOverwriteOpen(true);
              } else {
                saveToDrive(true);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : isGoogleExport || !file ? 'Save PDF to Drive' : 'Save'}
          </button>
        </div>
      </div>

      {/* Contextual Secondary Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/40">
        {activeToolTab === 'view' && (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowThumbnails((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
              >
                <Layers className="h-3.5 w-3.5" />
                Pages
              </button>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded-lg p-1 hover:bg-slate-200/60 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono tabular-nums">
                {currentPage} / {numPages || 1}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                className="rounded-lg p-1 hover:bg-slate-200/60 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFitMode('custom');
                  setScale((s) => Math.max(0.4, s - 0.15));
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setFitMode('width')}
                className={`rounded-lg px-2 py-1 ${
                  fitMode === 'width' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                Fit Width
              </button>
              <button
                type="button"
                onClick={() => setFitMode('page')}
                className={`rounded-lg px-2 py-1 ${
                  fitMode === 'page' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                Fit Page
              </button>
              <button
                type="button"
                onClick={() => {
                  setFitMode('custom');
                  setScale((s) => Math.min(3, s + 0.15));
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search PDF text..."
                  className="w-44 rounded-lg border border-slate-200 bg-white py-1 pl-8 pr-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              {searchMatches.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentPage(searchMatches[0].page)}
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  {searchMatches.length} match(es) (p.{searchMatches[0].page})
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowTextLayer((v) => !v)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
              >
                {showTextLayer ? 'Hide Text' : 'Select Text'}
              </button>
            </div>
          </>
        )}

        {activeToolTab === 'pages' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRotatePage}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <RotateCw className="h-3.5 w-3.5" /> Rotate 90°
            </button>
            <button
              type="button"
              onClick={() => handleReorderPage(-1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <ArrowUp className="h-3.5 w-3.5" /> Move Up
            </button>
            <button
              type="button"
              onClick={() => handleReorderPage(1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <ArrowDown className="h-3.5 w-3.5" /> Move Down
            </button>
            <button
              type="button"
              onClick={handleDeletePage}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Page {currentPage}
            </button>
            <button
              type="button"
              onClick={handleExtractSelected}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <Scissors className="h-3.5 w-3.5" /> Extract Selected ({selectedPages.size})
            </button>
          </div>
        )}

        {activeToolTab === 'annotate' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={annotText}
              onChange={(e) => setAnnotText(e.target.value)}
              placeholder="Annotation text"
              className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              type="number"
              value={annotX}
              onChange={(e) => setAnnotX(Number(e.target.value))}
              className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono dark:border-slate-700 dark:bg-slate-900"
              title="X coordinate"
            />
            <input
              type="number"
              value={annotY}
              onChange={(e) => setAnnotY(Number(e.target.value))}
              className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono dark:border-slate-700 dark:bg-slate-900"
              title="Y coordinate"
            />
            <button
              type="button"
              onClick={handleAddAnnotation}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              <Type className="h-3.5 w-3.5" /> Add Text
            </button>
            <input
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              placeholder="Watermark"
              className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
            />
            <button
              type="button"
              onClick={handleAddWatermark}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <Sparkles className="h-3.5 w-3.5" /> Watermark
            </button>
            <button
              type="button"
              onClick={handleAddPageNumbers}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              Page Numbers
            </button>
            <button
              type="button"
              onClick={() => setSigModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <PenTool className="h-3.5 w-3.5" /> Add Signature
            </button>
          </div>
        )}

        {activeToolTab === 'create' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <Files className="h-3.5 w-3.5" />
              <span>Merge Local PDF</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleMergeLocalPdf(f);
                }}
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <ImagePlus className="h-3.5 w-3.5" />
              <span>Append Images to PDF</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleImagesToPdf(e.target.files);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                mutatePdf((doc) => {
                  doc.addPage([612, 792]);
                }, 'Added blank page')
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> Add Blank Page
            </button>
          </div>
        )}
      </div>

      {/* Main Viewer Body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Loading PDF document...
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {showThumbnails && (
            <aside className="hidden w-40 shrink-0 overflow-y-auto border-r border-slate-200 p-2.5 sm:block dark:border-slate-800">
              <div className="space-y-2">
                {Array.from({ length: numPages }, (_, idx) => {
                  const pageNum = idx + 1;
                  const checked = selectedPages.has(pageNum);
                  return (
                    <div
                      key={pageNum}
                      className={`flex items-center justify-between rounded-xl border p-2 text-xs transition ${
                        currentPage === pageNum
                          ? 'border-blue-500 bg-blue-50/70 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setCurrentPage(pageNum)}
                        className="flex-1 text-left font-mono font-medium tabular-nums"
                      >
                        Page {pageNum}
                      </button>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedPages((prev) => {
                            const next = new Set(prev);
                            if (next.has(pageNum)) next.delete(pageNum);
                            else next.add(pageNum);
                            return next;
                          })
                        }
                        title="Select page for extraction"
                      />
                    </div>
                  );
                })}
              </div>
            </aside>
          )}

          <div
            ref={viewportContainerRef}
            className="flex flex-1 flex-col items-center overflow-auto bg-slate-100/80 p-6 dark:bg-[#0B0D11]"
          >
            <canvas
              ref={mainCanvasRef}
              className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800"
            />
          </div>

          {showTextLayer && (
            <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-500">
                Extracted Text (Page {currentPage})
              </p>
              <p className="mt-2 select-text whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {pageTexts[currentPage - 1] || 'No selectable text detected on this page.'}
              </p>
            </aside>
          )}
        </div>
      )}

      {/* Signature Drawing Modal */}
      <Dialog.Root open={sigModalOpen} onOpenChange={setSigModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-[#14171F]">
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-display text-sm font-semibold">
                Draw Signature
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="rounded-lg p-1 text-slate-400">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <canvas
              ref={sigCanvasRef}
              width={360}
              height={140}
              onPointerDown={(e) => {
                setIsDrawingSig(true);
                const rect = e.currentTarget.getBoundingClientRect();
                const ctx = e.currentTarget.getContext('2d')!;
                ctx.beginPath();
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                ctx.strokeStyle = '#0f172a';
                ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
              }}
              onPointerMove={(e) => {
                if (!isDrawingSig) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ctx = e.currentTarget.getContext('2d')!;
                ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                ctx.stroke();
              }}
              onPointerUp={() => setIsDrawingSig(false)}
              className="mt-3 w-full touch-none rounded-xl border border-slate-200 bg-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const c = sigCanvasRef.current;
                  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
                }}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleApplySignature}
                className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white"
              >
                Place on Page {currentPage}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={confirmOverwriteOpen}
        onOpenChange={setConfirmOverwriteOpen}
        title="Save modified PDF to Google Drive?"
        description={`Do you want to overwrite "${file?.name}" in Google Drive, or save as a new copy?`}
        confirmLabel="Overwrite Existing"
        loading={saving}
        onConfirm={async () => {
          setConfirmOverwriteOpen(false);
          await saveToDrive(false);
        }}
      />
    </div>
  );
};
