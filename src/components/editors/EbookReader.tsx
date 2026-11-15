import {
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileCode2,
  FileText,
  Highlighter,
  Library,
  List,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PenLine,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import {
  AnnotationColor,
  buildAnnotationsMarkdown,
  EbookAnnotationItem,
  EbookReadingStateItem,
  parseEpubArchive,
  ParsedEpub,
} from '../../lib/epubParser';
import { formatBytes, formatRelativeDate, getFileExtension } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface EbookReaderProps {
  file?: CloudFile;
  targetFolderId?: string;
}

type ReaderTheme = 'light' | 'sepia' | 'dark';
type ReaderFont = 'serif' | 'sans';

interface PdfOutlineItem {
  title: string;
  pageNumber: number;
}

const COLOR_SWATCHES: {
  id: AnnotationColor;
  label: string;
  dotClass: string;
  badgeClass: string;
  borderClass: string;
}[] = [
  {
    id: 'yellow',
    label: 'Yellow',
    dotClass: 'bg-amber-400',
    badgeClass: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    borderClass: 'border-l-amber-400',
  },
  {
    id: 'green',
    label: 'Green',
    dotClass: 'bg-emerald-400',
    badgeClass: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200',
    borderClass: 'border-l-emerald-400',
  },
  {
    id: 'blue',
    label: 'Blue',
    dotClass: 'bg-blue-400',
    badgeClass: 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200',
    borderClass: 'border-l-blue-400',
  },
  {
    id: 'pink',
    label: 'Pink',
    dotClass: 'bg-pink-400',
    badgeClass: 'bg-pink-100 text-pink-900 dark:bg-pink-950/60 dark:text-pink-200',
    borderClass: 'border-l-pink-400',
  },
];

function getColorMeta(color: AnnotationColor) {
  return COLOR_SWATCHES.find((c) => c.id === color) || COLOR_SWATCHES[0];
}

function detectFormat(file: CloudFile): 'epub' | 'pdf' {
  const ext = getFileExtension(file.name);
  if (ext === '.pdf' || file.mimeType.toLowerCase() === 'application/pdf') return 'pdf';
  return 'epub';
}

function applyEpubHighlights(
  container: HTMLElement,
  annotations: EbookAnnotationItem[],
  onClickAnnotation: (id: string) => void
) {
  // First unwrap any existing highlight <mark> nodes
  const existing = container.querySelectorAll('mark[data-ebook-ann]');
  existing.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });

  const withQuotes = annotations.filter((a) => a.quoteText && a.quoteText.trim().length >= 3);
  if (withQuotes.length === 0) return;

  for (const ann of withQuotes) {
    const needle = ann.quoteText.trim().replace(/\s+/g, ' ');
    if (!needle) continue;
    const lowerNeedle = needle.toLowerCase();

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE && current.nodeValue && current.nodeValue.trim()) {
        const parentEl = current.parentElement;
        if (!parentEl?.closest('mark[data-ebook-ann]')) {
          textNodes.push(current as Text);
        }
      }
      current = walker.nextNode();
    }

    // Try exact single-node match first, then first 48-char phrase fallback for multi-element selections
    const candidatePhrases =
      lowerNeedle.length > 48 ? [lowerNeedle, lowerNeedle.slice(0, 48).trim()] : [lowerNeedle];

    let matched = false;
    for (const phrase of candidatePhrases) {
      if (matched || phrase.length < 3) break;
      for (const node of textNodes) {
        const raw = node.nodeValue || '';
        const idx = raw.toLowerCase().indexOf(phrase);
        if (idx !== -1) {
          try {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, Math.min(raw.length, idx + phrase.length));
            const mark = document.createElement('mark');
            mark.className = `ebook-hl-${ann.color}`;
            mark.dataset.ebookAnn = ann.id;
            mark.title = ann.noteText ? ann.noteText : 'Highlight (click to inspect)';
            mark.addEventListener('click', (e) => {
              e.stopPropagation();
              onClickAnnotation(ann.id);
            });
            range.surroundContents(mark);
            matched = true;
            break;
          } catch {
            // Skip if range crosses boundary
          }
        }
      }
    }
  }
}

export const EbookReader: React.FC<EbookReaderProps> = ({ file: initialFile, targetFolderId }) => {
  const {
    storageProvider,
    settings,
    currentFolderId,
    triggerExplorerRefresh,
    openNewAppWindow,
    recordRecent,
  } = useDriveOS();

  const [activeFile, setActiveFile] = useState<CloudFile | undefined>(initialFile);

  // Library Picker state (when opened without a file or clicking "Library")
  const [libraryOpen, setLibraryOpen] = useState(!initialFile);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryBooks, setLibraryBooks] = useState<CloudFile[]>([]);
  const [readingStates, setReadingStates] = useState<EbookReadingStateItem[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const libraryUploadRef = useRef<HTMLInputElement>(null);

  // Active Book state
  const [loading, setLoading] = useState(Boolean(initialFile));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [format, setFormat] = useState<'epub' | 'pdf'>(
    initialFile ? detectFormat(initialFile) : 'epub'
  );
  const [bookTitle, setBookTitle] = useState(initialFile?.name || '');
  const [bookAuthor, setBookAuthor] = useState('');

  // EPUB state
  const [parsedEpub, setParsedEpub] = useState<ParsedEpub | null>(null);
  const epubCleanupRef = useRef<(() => void) | null>(null);
  const epubContentRef = useRef<HTMLDivElement>(null);

  // PDF state
  const pdfJsDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfTextLayerRef = useRef<HTMLDivElement>(null);
  const pdfPageWrapperRef = useRef<HTMLDivElement>(null);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfPageTexts, setPdfPageTexts] = useState<string[]>([]);
  const [pdfScale, setPdfScale] = useState(1.15);
  const [pdfFitMode, setPdfFitMode] = useState<'width' | 'page' | 'custom'>('width');
  const [pdfDocReadyTick, setPdfDocReadyTick] = useState(0);

  // Navigation & Progress state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [resumedBanner, setResumedBanner] = useState<string | null>(null);
  const pendingRestoreScrollRef = useRef<number | null>(null);
  const progressLoadedForFileRef = useRef<string | null>(null);
  const latestProgressPayloadRef = useRef<{
    fileId: string;
    fileName: string;
    format: 'epub' | 'pdf';
    currentLocation: string;
    currentPage: number;
    totalPages: number;
    scrollPercent: number;
    progressPercent: number;
    bookTitle: string;
    bookAuthor: string;
  } | null>(null);

  // Annotations state
  const [annotations, setAnnotations] = useState<EbookAnnotationItem[]>([]);
  const [colorFilter, setColorFilter] = useState<AnnotationColor | 'all'>('all');
  const [annotationSearch, setAnnotationSearch] = useState('');
  const [highlightedAnnId, setHighlightedAnnId] = useState<string | null>(null);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState('');
  const [editingColorDraft, setEditingColorDraft] = useState<AnnotationColor>('yellow');
  const [deleteAnnTarget, setDeleteAnnTarget] = useState<EbookAnnotationItem | null>(null);

  // Selection & Quick Note Composer
  const [selectionDraft, setSelectionDraft] = useState<{
    quoteText: string;
    noteText: string;
    color: AnnotationColor;
    pageNumber: number;
    chapterTitle: string;
  } | null>(null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [quickNoteColor, setQuickNoteColor] = useState<AnnotationColor>('yellow');
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // Reader UI & Typography state
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'toc' | 'annotations'>('annotations');
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(
    settings.theme === 'dark' ? 'dark' : 'light'
  );
  const [readerFont, setReaderFont] = useState<ReaderFont>('serif');
  const [fontSizePx, setFontSizePx] = useState(17);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingMd, setExportingMd] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Load Library (Drive EPUBs + PDFs and reading states)
  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const [epubRes, pdfRes, statesRes] = await Promise.all([
        storageProvider.listFiles({ search: '.epub', pageSize: 50, orderBy: 'modifiedTime desc' }),
        storageProvider.listFiles({ mimeFilter: 'pdfs', pageSize: 50, orderBy: 'modifiedTime desc' }),
        apiFetch<{ states: EbookReadingStateItem[] }>('/api/ebook/states').catch(() => ({
          states: [],
        })),
      ]);
      const merged = new Map<string, CloudFile>();
      for (const f of [...epubRes.files, ...pdfRes.files]) {
        if (f.isFolder || f.trashed) continue;
        const ext = getFileExtension(f.name);
        if (ext === '.epub' || ext === '.pdf' || f.mimeType === 'application/pdf') {
          merged.set(f.id, f);
        }
      }
      setLibraryBooks(Array.from(merged.values()));
      setReadingStates(statesRes.states || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load Drive e-books');
    } finally {
      setLibraryLoading(false);
    }
  }, [storageProvider]);

  useEffect(() => {
    if (libraryOpen) {
      loadLibrary();
    }
  }, [libraryOpen, loadLibrary]);

  const readingStateByFileId = useMemo(() => {
    const map = new Map<string, EbookReadingStateItem>();
    for (const s of readingStates) {
      map.set(s.fileId, s);
    }
    return map;
  }, [readingStates]);

  // Compute current chapter title
  const currentChapterTitle = useMemo(() => {
    if (format === 'epub' && parsedEpub) {
      return parsedEpub.chapters[currentPage - 1]?.title || `Section ${currentPage}`;
    }
    if (format === 'pdf' && pdfOutline.length > 0) {
      let matched = '';
      for (const item of pdfOutline) {
        if (item.pageNumber <= currentPage) matched = item.title;
        else break;
      }
      return matched;
    }
    return '';
  }, [currentPage, format, parsedEpub, pdfOutline]);

  // Compute overall reading progress percentage
  const progressPercent = useMemo(() => {
    const safeTotal = Math.max(1, totalPages);
    if (safeTotal === 1) return scrollPercent;
    const base = ((currentPage - 1) / safeTotal) * 100;
    const within = (scrollPercent / 100) * (100 / safeTotal);
    return Math.min(100, Math.max(0, Math.round(base + within)));
  }, [currentPage, scrollPercent, totalPages]);

  // Sync page input field
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Persist reading progress helper
  const persistProgressNow = useCallback(async () => {
    const payload = latestProgressPayloadRef.current;
    if (!payload || !progressLoadedForFileRef.current) return;
    if (progressLoadedForFileRef.current !== payload.fileId) return;
    try {
      await apiFetch(`/api/ebook/${encodeURIComponent(payload.fileId)}/progress`, {
        method: 'PUT',
        body: JSON.stringify({
          fileName: payload.fileName,
          format: payload.format,
          currentLocation: payload.currentLocation,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages,
          scrollPercent: payload.scrollPercent,
          progressPercent: payload.progressPercent,
          bookTitle: payload.bookTitle,
          bookAuthor: payload.bookAuthor || null,
        }),
      });
    } catch {
      // non-blocking background save
    }
  }, []);

  // Track latest progress ref & debounce save
  useEffect(() => {
    if (!activeFile || loading || progressLoadedForFileRef.current !== activeFile.id) return;
    latestProgressPayloadRef.current = {
      fileId: activeFile.id,
      fileName: activeFile.name,
      format,
      currentLocation: String(currentPage),
      currentPage,
      totalPages: Math.max(1, totalPages),
      scrollPercent,
      progressPercent,
      bookTitle: bookTitle || activeFile.name,
      bookAuthor,
    };

    const timer = window.setTimeout(() => {
      persistProgressNow();
    }, 750);

    return () => window.clearTimeout(timer);
  }, [
    activeFile,
    bookAuthor,
    bookTitle,
    currentPage,
    format,
    loading,
    persistProgressNow,
    progressPercent,
    scrollPercent,
    totalPages,
  ]);

  // Flush progress on unmount
  useEffect(() => {
    return () => {
      persistProgressNow();
      if (epubCleanupRef.current) {
        epubCleanupRef.current();
        epubCleanupRef.current = null;
      }
      if (pdfJsDocRef.current) {
        pdfJsDocRef.current.cleanup().catch(() => {});
        pdfJsDocRef.current = null;
      }
    };
  }, [persistProgressNow]);

  // Load book file + saved progress + annotations
  useEffect(() => {
    if (!activeFile) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fmt = detectFormat(activeFile);
    setFormat(fmt);
    setLoading(true);
    setLoadError(null);
    setResumedBanner(null);
    setSelectionDraft(null);
    setBookSearchQuery('');
    progressLoadedForFileRef.current = null;

    if (epubCleanupRef.current) {
      epubCleanupRef.current();
      epubCleanupRef.current = null;
    }
    if (pdfJsDocRef.current) {
      pdfJsDocRef.current.cleanup().catch(() => {});
      pdfJsDocRef.current = null;
    }
    setParsedEpub(null);
    setPdfOutline([]);
    setPdfPageTexts([]);

    const loadBook = async () => {
      try {
        const [blob, savedRes] = await Promise.all([
          storageProvider.downloadBlob(activeFile.id),
          apiFetch<{
            state: EbookReadingStateItem | null;
            annotations: EbookAnnotationItem[];
          }>(`/api/ebook/${encodeURIComponent(activeFile.id)}`).catch(() => ({
            state: null,
            annotations: [],
          })),
        ]);

        if (cancelled) return;
        const arrayBuf = await blob.arrayBuffer();
        if (cancelled) return;

        setAnnotations(savedRes.annotations || []);
        const savedState = savedRes.state;

        if (fmt === 'epub') {
          const parsed = await parseEpubArchive(arrayBuf);
          if (cancelled) {
            parsed.cleanup();
            return;
          }
          epubCleanupRef.current = parsed.cleanup;
          setParsedEpub(parsed);
          setBookTitle(parsed.title || activeFile.name.replace(/\.epub$/i, ''));
          setBookAuthor(parsed.author || '');
          const total = Math.max(1, parsed.chapters.length);
          setTotalPages(total);

          const targetPage = savedState
            ? Math.min(Math.max(1, savedState.currentPage), total)
            : 1;
          setCurrentPage(targetPage);
          if (savedState && (savedState.currentPage > 1 || savedState.scrollPercent > 3)) {
            pendingRestoreScrollRef.current = savedState.scrollPercent;
            setScrollPercent(savedState.scrollPercent);
            setResumedBanner(
              `Resumed from ${parsed.chapters[targetPage - 1]?.title || `Section ${targetPage}`} (${savedState.progressPercent}%)`
            );
          } else {
            setScrollPercent(0);
          }
        } else {
          const copy = new Uint8Array(arrayBuf);
          const doc = await pdfjsLib.getDocument({ data: copy }).promise;
          if (cancelled) {
            doc.cleanup().catch(() => {});
            return;
          }
          pdfJsDocRef.current = doc;
          const total = Math.max(1, doc.numPages);
          setTotalPages(total);

          // Extract PDF metadata
          let metaTitle = activeFile.name.replace(/\.pdf$/i, '');
          let metaAuthor = '';
          try {
            const meta = await doc.getMetadata();
            const info = (meta?.info || {}) as Record<string, unknown>;
            if (typeof info.Title === 'string' && info.Title.trim()) {
              metaTitle = info.Title.trim();
            }
            if (typeof info.Author === 'string' && info.Author.trim()) {
              metaAuthor = info.Author.trim();
            }
          } catch {
            // optional metadata
          }
          setBookTitle(metaTitle);
          setBookAuthor(metaAuthor);

          // Extract PDF outline if available
          try {
            const outline = await doc.getOutline();
            if (outline && Array.isArray(outline)) {
              const items: PdfOutlineItem[] = [];
              const resolveOutline = async (nodes: any[]) => {
                for (const node of nodes) {
                  let pageNum = 1;
                  try {
                    let dest = node.dest;
                    if (typeof dest === 'string') {
                      dest = await doc.getDestination(dest);
                    }
                    if (Array.isArray(dest) && dest[0]) {
                      const idx = await doc.getPageIndex(dest[0]);
                      pageNum = idx + 1;
                    }
                  } catch {
                    pageNum = 1;
                  }
                  if (node.title) {
                    items.push({ title: String(node.title), pageNumber: pageNum });
                  }
                  if (Array.isArray(node.items) && node.items.length > 0 && items.length < 150) {
                    await resolveOutline(node.items);
                  }
                }
              };
              await resolveOutline(outline);
              if (!cancelled) setPdfOutline(items);
            }
          } catch {
            // optional outline
          }

          const targetPage = savedState
            ? Math.min(Math.max(1, savedState.currentPage), total)
            : 1;
          setCurrentPage(targetPage);
          if (savedState && (savedState.currentPage > 1 || savedState.scrollPercent > 3)) {
            pendingRestoreScrollRef.current = savedState.scrollPercent;
            setScrollPercent(savedState.scrollPercent);
            setResumedBanner(`Resumed from Page ${targetPage} (${savedState.progressPercent}%)`);
          } else {
            setScrollPercent(0);
          }

          setPdfDocReadyTick((t) => t + 1);

          // Background text extraction for PDF search
          const texts: string[] = [];
          for (let i = 1; i <= doc.numPages; i++) {
            if (cancelled) break;
            try {
              const p = await doc.getPage(i);
              const tc = await p.getTextContent();
              texts.push(tc.items.map((it: any) => it.str || '').join(' '));
            } catch {
              texts.push('');
            }
          }
          if (!cancelled) setPdfPageTexts(texts);
        }

        if (!cancelled) {
          progressLoadedForFileRef.current = activeFile.id;
          recordRecent(activeFile);
        }
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err?.message || 'Unable to open e-book file');
          toast.error(err?.message || 'Unable to open e-book file');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadBook();
    return () => {
      cancelled = true;
    };
  }, [activeFile, recordRecent, storageProvider]);

  // Render PDF page + selectable TextLayer when PDF state changes
  const renderPdfPage = useCallback(async () => {
    if (format !== 'pdf' || loading) return;
    const doc = pdfJsDocRef.current;
    const canvas = pdfCanvasRef.current;
    const textLayerDiv = pdfTextLayerRef.current;
    const wrapperDiv = pdfPageWrapperRef.current;
    const container = viewportRef.current;
    if (!doc || !canvas || !textLayerDiv || !wrapperDiv) return;
    if (currentPage < 1 || currentPage > doc.numPages) return;

    try {
      const page = await doc.getPage(currentPage);
      const unscaled = page.getViewport({ scale: 1 });

      let targetScale = pdfScale;
      if (container) {
        const cw = Math.max(280, container.clientWidth - 48);
        const ch = Math.max(320, container.clientHeight - 48);
        if (pdfFitMode === 'width') {
          targetScale = Math.min(2.2, cw / unscaled.width);
        } else if (pdfFitMode === 'page') {
          targetScale = Math.min(cw / unscaled.width, ch / unscaled.height);
        }
      }

      const viewport = page.getViewport({ scale: targetScale });
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      wrapperDiv.style.width = `${cssWidth}px`;
      wrapperDiv.style.height = `${cssHeight}px`;
      wrapperDiv.style.setProperty('--total-scale-factor', String(targetScale));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }

      // Render selectable text layer
      textLayerDiv.innerHTML = '';
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();

      // Highlight spans on this PDF page that match saved quotes
      const pageAnns = annotations.filter(
        (a) => a.pageNumber === currentPage && a.quoteText.trim().length >= 3
      );
      if (pageAnns.length > 0) {
        const spans = Array.from(textLayerDiv.querySelectorAll('span'));
        const bgMap: Record<AnnotationColor, string> = {
          yellow: 'rgba(250, 204, 21, 0.32)',
          green: 'rgba(74, 222, 128, 0.28)',
          blue: 'rgba(96, 165, 250, 0.28)',
          pink: 'rgba(244, 114, 182, 0.28)',
        };
        for (const span of spans) {
          const txt = (span.textContent || '').trim().toLowerCase();
          if (txt.length < 3) continue;
          const matchingAnn = pageAnns.find((a) => a.quoteText.toLowerCase().includes(txt));
          if (matchingAnn) {
            span.style.backgroundColor = bgMap[matchingAnn.color];
            span.style.borderRadius = '2px';
          }
        }
      }

      // Restore scroll position after page finishes rendering
      if (pendingRestoreScrollRef.current !== null && container) {
        const pct = pendingRestoreScrollRef.current;
        pendingRestoreScrollRef.current = null;
        requestAnimationFrame(() => {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          container.scrollTop = (pct / 100) * maxScroll;
        });
      }
    } catch (err) {
      console.error('PDF render error:', err);
    }
  }, [annotations, currentPage, format, loading, pdfFitMode, pdfScale]);

  useEffect(() => {
    renderPdfPage();
  }, [renderPdfPage, pdfDocReadyTick]);

  // Apply EPUB highlights + restore scroll when chapter renders
  useEffect(() => {
    if (format !== 'epub' || loading || !parsedEpub || !epubContentRef.current) return;
    const chapterAnns = annotations.filter((a) => a.pageNumber === currentPage);
    applyEpubHighlights(epubContentRef.current, chapterAnns, (annId) => {
      setSidebarOpen(true);
      setSidebarTab('annotations');
      setHighlightedAnnId(annId);
    });

    const container = viewportRef.current;
    if (pendingRestoreScrollRef.current !== null && container) {
      const pct = pendingRestoreScrollRef.current;
      pendingRestoreScrollRef.current = null;
      requestAnimationFrame(() => {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = (pct / 100) * maxScroll;
      });
    }
  }, [annotations, currentPage, fontSizePx, format, loading, parsedEpub, readerFont]);

  // Auto-hide resumed banner after 4s
  useEffect(() => {
    if (!resumedBanner) return;
    const t = window.setTimeout(() => setResumedBanner(null), 4500);
    return () => window.clearTimeout(t);
  }, [resumedBanner]);

  // Re-render PDF on container resize if fitMode != custom
  useEffect(() => {
    if (format !== 'pdf') return;
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pdfFitMode !== 'custom') {
        renderPdfPage();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [format, pdfFitMode, renderPdfPage]);

  // Keyboard navigation
  useEffect(() => {
    if (libraryOpen || !activeFile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        goToPage(currentPage - 1);
      } else if (e.key === 'ArrowRight') {
        goToPage(currentPage + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const goToPage = (target: number, resetScroll = true) => {
    const clamped = Math.min(Math.max(1, target), Math.max(1, totalPages));
    if (clamped !== currentPage) {
      setCurrentPage(clamped);
      if (resetScroll) {
        setScrollPercent(0);
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
      }
    }
  };

  const handleViewportScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 4) {
      setScrollPercent(0);
      return;
    }
    const pct = Math.min(100, Math.max(0, Math.round((el.scrollTop / maxScroll) * 100)));
    setScrollPercent(pct);
  };

  // Handle text selection inside EPUB or PDF viewport
  const handleCheckSelection = () => {
    if (!activeFile) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const rawText = sel.toString().replace(/\s+/g, ' ').trim();
    if (rawText.length < 2) return;

    const anchorNode = sel.anchorNode;
    if (anchorNode && viewportRef.current && !viewportRef.current.contains(anchorNode)) {
      return;
    }

    setSelectionDraft({
      quoteText: rawText.slice(0, 4000),
      noteText: '',
      color: 'yellow',
      pageNumber: currentPage,
      chapterTitle: currentChapterTitle,
    });
  };

  const handleSaveSelectionAnnotation = async () => {
    if (!activeFile || !selectionDraft) return;
    setSavingAnnotation(true);
    try {
      const res = await apiFetch<{ annotation: EbookAnnotationItem }>(
        `/api/ebook/${encodeURIComponent(activeFile.id)}/annotations`,
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: activeFile.name,
            format,
            pageNumber: selectionDraft.pageNumber,
            chapterTitle: selectionDraft.chapterTitle || null,
            quoteText: selectionDraft.quoteText,
            noteText: selectionDraft.noteText.trim(),
            color: selectionDraft.color,
          }),
        }
      );
      setAnnotations((prev) => [...prev, res.annotation]);
      setSelectionDraft(null);
      window.getSelection()?.removeAllRanges();
      setSidebarOpen(true);
      setSidebarTab('annotations');
      toast.success('Highlight & annotation saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save annotation');
    } finally {
      setSavingAnnotation(false);
    }
  };

  const handleSaveQuickNote = async () => {
    if (!activeFile || !quickNoteText.trim()) return;
    setSavingAnnotation(true);
    try {
      const res = await apiFetch<{ annotation: EbookAnnotationItem }>(
        `/api/ebook/${encodeURIComponent(activeFile.id)}/annotations`,
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: activeFile.name,
            format,
            pageNumber: currentPage,
            chapterTitle: currentChapterTitle || null,
            quoteText: '',
            noteText: quickNoteText.trim(),
            color: quickNoteColor,
          }),
        }
      );
      setAnnotations((prev) => [...prev, res.annotation]);
      setQuickNoteText('');
      setQuickNoteOpen(false);
      setSidebarOpen(true);
      setSidebarTab('annotations');
      toast.success('Note added');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save note');
    } finally {
      setSavingAnnotation(false);
    }
  };

  const handleSaveEditedAnnotation = async (ann: EbookAnnotationItem) => {
    if (!activeFile) return;
    try {
      const res = await apiFetch<{ annotation: EbookAnnotationItem }>(
        `/api/ebook/${encodeURIComponent(activeFile.id)}/annotations/${encodeURIComponent(ann.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            noteText: editingNoteDraft.trim(),
            color: editingColorDraft,
          }),
        }
      );
      setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? res.annotation : a)));
      setEditingAnnId(null);
      toast.success('Annotation updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update annotation');
    }
  };

  const handleDeleteAnnotationConfirmed = async () => {
    if (!activeFile || !deleteAnnTarget) return;
    const target = deleteAnnTarget;
    setDeleteAnnTarget(null);
    try {
      await apiFetch(
        `/api/ebook/${encodeURIComponent(activeFile.id)}/annotations/${encodeURIComponent(target.id)}`,
        { method: 'DELETE' }
      );
      setAnnotations((prev) => prev.filter((a) => a.id !== target.id));
      toast.success('Annotation deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete annotation');
    }
  };

  // Markdown export helpers
  const generateMarkdownExport = () => {
    return buildAnnotationsMarkdown({
      bookTitle: bookTitle || activeFile?.name || 'Book',
      bookAuthor,
      fileName: activeFile?.name || 'book',
      format,
      progressPercent,
      annotations,
    });
  };

  const getExportFileName = () => {
    const base = (bookTitle || activeFile?.name || 'Book')
      .replace(/\.(epub|pdf)$/i, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    return `${base || 'Book'} - Annotations.md`;
  };

  const handleSaveMarkdownToDrive = async () => {
    if (!activeFile) return;
    setExportingMd(true);
    setExportMenuOpen(false);
    try {
      const md = generateMarkdownExport();
      const exportName = getExportFileName();
      const destFolder = activeFile.parents?.[0] || targetFolderId || currentFolderId || 'root';
      const saved = await storageProvider.uploadFile(
        new Blob([md], { type: 'text/markdown' }),
        exportName,
        'text/markdown',
        destFolder
      );
      triggerExplorerRefresh();
      toast.success(`Saved "${saved.name}" to Google Drive`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save Markdown to Drive');
    } finally {
      setExportingMd(false);
    }
  };

  const handleOpenInMarkdownStudio = () => {
    setExportMenuOpen(false);
    const md = generateMarkdownExport();
    const exportName = getExportFileName();
    const destFolder = activeFile?.parents?.[0] || targetFolderId || currentFolderId || 'root';
    openNewAppWindow({
      appId: 'markdown',
      title: exportName,
      initialContent: md,
      targetFolderId: destFolder,
    });
  };

  const handleDownloadMarkdown = () => {
    setExportMenuOpen(false);
    const md = generateMarkdownExport();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getExportFileName();
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded annotations Markdown');
  };

  const handleUploadEbookToDrive = async (fileList: FileList) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const tid = toast.loading('Uploading e-book to Google Drive...');
    try {
      let lastUploaded: CloudFile | null = null;
      for (const f of arr) {
        const ext = getFileExtension(f.name);
        const mime =
          ext === '.epub'
            ? 'application/epub+zip'
            : ext === '.pdf'
              ? 'application/pdf'
              : f.type || 'application/octet-stream';
        lastUploaded = await storageProvider.uploadFile(
          f,
          f.name,
          mime,
          targetFolderId || currentFolderId || 'root'
        );
      }
      toast.dismiss(tid);
      triggerExplorerRefresh();
      await loadLibrary();
      if (lastUploaded) {
        setActiveFile(lastUploaded);
        setLibraryOpen(false);
      }
      toast.success('Uploaded to Google Drive');
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error(err.message || 'Upload failed');
    }
  };

  // Filtered annotations
  const filteredAnnotations = useMemo(() => {
    const q = annotationSearch.trim().toLowerCase();
    return [...annotations]
      .sort((a, b) => {
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .filter((a) => {
        if (colorFilter !== 'all' && a.color !== colorFilter) return false;
        if (
          q &&
          !a.quoteText.toLowerCase().includes(q) &&
          !a.noteText.toLowerCase().includes(q) &&
          !(a.chapterTitle || '').toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      });
  }, [annotationSearch, annotations, colorFilter]);

  const currentPageAnnotations = useMemo(
    () => annotations.filter((a) => a.pageNumber === currentPage),
    [annotations, currentPage]
  );

  // Full-book search matches
  const bookSearchMatches = useMemo(() => {
    const q = bookSearchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const results: { pageNumber: number; title: string; snippet: string }[] = [];

    if (format === 'epub' && parsedEpub) {
      for (const ch of parsedEpub.chapters) {
        const idx = ch.plainText.toLowerCase().indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 35);
          const end = Math.min(ch.plainText.length, idx + q.length + 55);
          results.push({
            pageNumber: ch.index,
            title: ch.title,
            snippet: ch.plainText.slice(start, end),
          });
        }
      }
    } else if (format === 'pdf' && pdfPageTexts.length > 0) {
      pdfPageTexts.forEach((txt, i) => {
        const idx = txt.toLowerCase().indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 35);
          const end = Math.min(txt.length, idx + q.length + 55);
          results.push({
            pageNumber: i + 1,
            title: `Page ${i + 1}`,
            snippet: txt.slice(start, end),
          });
        }
      });
    }
    return results.slice(0, 40);
  }, [bookSearchQuery, format, parsedEpub, pdfPageTexts]);

  // Filtered library books
  const filteredLibraryBooks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return libraryBooks.filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [libraryBooks, librarySearch]);

  const continueReadingBooks = useMemo(() => {
    return readingStates
      .map((st) => ({
        state: st,
        file: libraryBooks.find((b) => b.id === st.fileId),
      }))
      .slice(0, 4);
  }, [libraryBooks, readingStates]);

  const themeSurfaceClasses =
    readerTheme === 'sepia'
      ? 'bg-[#F6F1E7] text-[#3B2F23]'
      : readerTheme === 'dark'
        ? 'bg-[#0F1218] text-slate-200'
        : 'bg-white text-slate-900';

  const outerThemeClasses =
    readerTheme === 'sepia'
      ? 'bg-[#EFE8D8]'
      : readerTheme === 'dark'
        ? 'bg-[#090B0F]'
        : 'bg-slate-100/80 dark:bg-[#0B0D11]';

  // Library / Bookshelf View
  if (libraryOpen || !activeFile) {
    return (
      <div
        className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F] ${
          fullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11rem)] min-h-[560px]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <BookOpen className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                E-Book Reader Library
              </h1>
              <p className="text-xs text-slate-500">
                Open EPUB &amp; PDF books from Google Drive with synced progress &amp; Markdown highlights
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search EPUB & PDF..."
                className="w-48 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => libraryUploadRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload EPUB / PDF
            </button>
            <input
              ref={libraryUploadRef}
              type="file"
              accept=".epub,.pdf,application/epub+zip,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleUploadEbookToDrive(e.target.files)}
            />

            {activeFile && (
              <button
                type="button"
                onClick={() => setLibraryOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Back to Book
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {libraryLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40"
                />
              ))}
            </div>
          ) : (
            <>
              {continueReadingBooks.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <BookMarked className="h-3.5 w-3.5 text-amber-500" />
                    Continue Reading
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {continueReadingBooks.map(({ state, file: matched }) => (
                      <button
                        key={state.fileId}
                        type="button"
                        onClick={async () => {
                          if (matched) {
                            setActiveFile(matched);
                            setLibraryOpen(false);
                          } else {
                            try {
                              const fetched = await storageProvider.getFile(state.fileId);
                              setActiveFile(fetched);
                              setLibraryOpen(false);
                            } catch {
                              toast.error('This file is no longer accessible in Google Drive');
                            }
                          }
                        }}
                        className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-blue-500 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-blue-500"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              {state.format}
                            </span>
                            <span className="font-mono text-[11px] font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                              {state.progressPercent}%
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {state.bookTitle || state.fileName}
                          </p>
                          {state.bookAuthor && (
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              {state.bookAuthor}
                            </p>
                          )}
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-blue-600"
                              style={{ width: `${state.progressPercent}%` }}
                            />
                          </div>
                          <p className="font-mono text-[10px] text-slate-500 tabular-nums">
                            {state.format === 'pdf' ? 'Page' : 'Section'} {state.currentPage} /{' '}
                            {state.totalPages}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
                  EPUB &amp; PDF Files in Google Drive ({filteredLibraryBooks.length})
                </h2>
                {filteredLibraryBooks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-14 text-center dark:border-slate-800">
                    <BookOpen className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                    <p className="mt-3 font-display text-sm font-semibold text-slate-800 dark:text-slate-200">
                      No EPUB or PDF books found
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500">
                      Upload an <code className="font-mono">.epub</code> or{' '}
                      <code className="font-mono">.pdf</code> file to Google Drive to start reading and annotating.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredLibraryBooks.map((book) => {
                      const st = readingStateByFileId.get(book.id);
                      const isEpub = detectFormat(book) === 'epub';
                      return (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => {
                            setActiveFile(book);
                            setLibraryOpen(false);
                          }}
                          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-500 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-blue-500"
                        >
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              isEpub
                                ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
                                : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                            }`}
                          >
                            {isEpub ? <BookOpen className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {book.name}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                              {formatBytes(book.size)} · {formatRelativeDate(book.modifiedTime)}
                            </p>
                            {st && (
                              <div className="mt-2 flex items-center gap-2">
                                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                  <div
                                    className="h-full rounded-full bg-blue-600"
                                    style={{ width: `${st.progressPercent}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[10px] font-medium text-blue-600 tabular-nums dark:text-blue-400">
                                  {st.progressPercent}%
                                </span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F] ${
        fullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11rem)] min-h-[580px]'
      }`}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              persistProgressNow();
              setLibraryOpen(true);
            }}
            title="Switch Book / Library"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Library className="h-3.5 w-3.5 text-amber-600" />
            <span className="hidden sm:inline">Library</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="max-w-[200px] truncate font-display text-sm font-semibold text-slate-900 sm:max-w-[300px] dark:text-slate-100">
                {bookTitle || activeFile.name}
              </h1>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {format}
              </span>
            </div>
            {(bookAuthor || currentChapterTitle) && (
              <p className="max-w-[320px] truncate text-[11px] text-slate-500">
                {[bookAuthor, currentChapterTitle].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setQuickNoteOpen((v) => !v);
              setSidebarOpen(true);
              setSidebarTab('annotations');
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-blue-600" />
            <span>Add Note</span>
          </button>

          {/* Export Annotations to Markdown dropdown */}
          <div className="relative">
            <button
              type="button"
              disabled={exportingMd}
              onClick={() => setExportMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              <span>{exportingMd ? 'Exporting...' : `Export .md (${annotations.length})`}</span>
            </button>

            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-[#14171F]">
                  <button
                    type="button"
                    onClick={handleSaveMarkdownToDrive}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Save className="h-3.5 w-3.5 text-blue-600" />
                    <div>
                      <p>Save .md to Google Drive</p>
                      <p className="text-[10px] text-slate-400">Creates Markdown notes file in Drive</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenInMarkdownStudio}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-emerald-600" />
                    <div>
                      <p>Open in Markdown Studio</p>
                      <p className="text-[10px] text-slate-400">Edit, preview &amp; export formatted PDF</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadMarkdown}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-500" />
                    <div>
                      <p>Download .md locally</p>
                      <p className="text-[10px] text-slate-400">{getExportFileName()}</p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle Contents & Annotations"
            className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium ${
              sidebarOpen
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            <Highlighter className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Notes</span>
            <span className="font-mono text-[11px] tabular-nums">({annotations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen Reader'}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Secondary Reading Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/40">
        {/* Page / Chapter navigation */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage <= 1 || loading}
            onClick={() => goToPage(currentPage - 1)}
            className="rounded-lg border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(pageInput);
              if (Number.isFinite(parsed)) goToPage(parsed);
            }}
            className="flex items-center gap-1"
          >
            <span className="text-slate-500">{format === 'pdf' ? 'Page' : 'Sec'}</span>
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                const parsed = Number(pageInput);
                if (Number.isFinite(parsed) && parsed >= 1) goToPage(parsed);
                else setPageInput(String(currentPage));
              }}
              className="w-12 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-center font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
            />
            <span className="font-mono text-slate-500 tabular-nums">/ {totalPages}</span>
          </form>

          <button
            type="button"
            disabled={currentPage >= totalPages || loading}
            onClick={() => goToPage(currentPage + 1)}
            className="rounded-lg border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <span className="ml-1 rounded-full bg-slate-200/70 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {progressPercent}%
          </span>
        </div>

        {/* Typography (EPUB) OR Zoom (PDF) + Paper Theme */}
        <div className="flex flex-wrap items-center gap-2">
          {format === 'epub' ? (
            <>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {(['serif', 'sans'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setReaderFont(f)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${
                      readerFont === f
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFontSizePx((s) => Math.max(13, s - 1))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 font-mono dark:border-slate-700 dark:bg-slate-900"
                >
                  A-
                </button>
                <span className="w-8 text-center font-mono text-[11px] tabular-nums">{fontSizePx}</span>
                <button
                  type="button"
                  onClick={() => setFontSizePx((s) => Math.min(26, s + 1))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 font-mono dark:border-slate-700 dark:bg-slate-900"
                >
                  A+
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setPdfFitMode('custom');
                  setPdfScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))));
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 dark:border-slate-700 dark:bg-slate-900"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setPdfFitMode('width')}
                className={`rounded-lg px-2 py-0.5 ${
                  pdfFitMode === 'width'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                Fit Width
              </button>
              <button
                type="button"
                onClick={() => setPdfFitMode('page')}
                className={`rounded-lg px-2 py-0.5 ${
                  pdfFitMode === 'page'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                Fit Page
              </button>
              <button
                type="button"
                onClick={() => {
                  setPdfFitMode('custom');
                  setPdfScale((s) => Math.min(2.6, Number((s + 0.15).toFixed(2))));
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 dark:border-slate-700 dark:bg-slate-900"
              >
                +
              </button>
            </div>
          )}

          {/* Reading Theme Switcher */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {(
              [
                ['light', 'Light'],
                ['sepia', 'Sepia'],
                ['dark', 'Night'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setReaderTheme(id)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  readerTheme === id
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumed Progress Banner */}
      {resumedBanner && (
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50/90 px-4 py-1.5 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-200">
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            {resumedBanner}
          </span>
          <button
            type="button"
            onClick={() => setResumedBanner(null)}
            className="rounded p-0.5 hover:bg-blue-200/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Split Reader Workspace */}
      <div className="relative flex min-h-0 flex-1">
        {/* Reading Canvas / Prose Viewport */}
        <div
          ref={viewportRef}
          onScroll={handleViewportScroll}
          onMouseUp={handleCheckSelection}
          onTouchEnd={handleCheckSelection}
          className={`relative flex-1 overflow-y-auto px-4 py-6 sm:px-8 ${outerThemeClasses}`}
        >
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
              <BookOpen className="h-7 w-7 animate-pulse text-amber-500" />
              <span>Loading {format.toUpperCase()} book from Google Drive...</span>
            </div>
          ) : loadError ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="font-semibold">Unable to open book</p>
              <p className="mt-1">{loadError}</p>
            </div>
          ) : format === 'epub' && parsedEpub ? (
            <article
              className={`mx-auto max-w-3xl rounded-2xl border border-slate-200/70 px-6 py-8 shadow-xs sm:px-12 sm:py-10 dark:border-slate-800 ${themeSurfaceClasses}`}
              style={{
                fontSize: `${fontSizePx}px`,
                lineHeight: 1.72,
                fontFamily:
                  readerFont === 'serif'
                    ? 'Georgia, Cambria, "Times New Roman", Times, serif'
                    : 'var(--font-sans)',
              }}
            >
              <div className="mb-6 border-b border-current/10 pb-3 text-xs opacity-60">
                <span>{parsedEpub.chapters[currentPage - 1]?.title}</span>
              </div>
              <div
                ref={epubContentRef}
                className="ebook-prose select-text"
                dangerouslySetInnerHTML={{
                  __html: parsedEpub.chapters[currentPage - 1]?.html || '',
                }}
              />
              {/* Bottom Next/Prev Section navigation inside chapter */}
              <div className="mt-10 flex items-center justify-between border-t border-current/10 pt-5 text-xs">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => goToPage(currentPage - 1)}
                  className="inline-flex items-center gap-1 rounded-xl border border-current/20 px-3 py-1.5 font-medium disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous Section
                </button>
                <span className="font-mono opacity-60 tabular-nums">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => goToPage(currentPage + 1)}
                  className="inline-flex items-center gap-1 rounded-xl border border-current/20 px-3 py-1.5 font-medium disabled:opacity-35"
                >
                  Next Section <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                ref={pdfPageWrapperRef}
                className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md dark:border-slate-800"
              >
                <canvas ref={pdfCanvasRef} className="block" />
                <div ref={pdfTextLayerRef} className="textLayer" />
              </div>
              <p className="text-[11px] text-slate-400">
                Tip: Select any text on the page to highlight &amp; annotate, or use &ldquo;Add Note&rdquo; for scanned pages.
              </p>
            </div>
          )}

          {/* Floating Selection Annotation Bar */}
          {selectionDraft && (
            <div className="sticky bottom-3 z-20 mx-auto mt-4 max-w-xl rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md dark:border-slate-700 dark:bg-[#14171F]/95">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <Highlighter className="h-3.5 w-3.5 text-amber-500" />
                    Selected Quote ({format === 'pdf' ? `Page ${selectionDraft.pageNumber}` : `Section ${selectionDraft.pageNumber}`})
                  </p>
                  <p className="mt-1 line-clamp-2 border-l-2 border-amber-400 pl-2 text-xs italic text-slate-700 dark:text-slate-300">
                    &ldquo;{selectionDraft.quoteText}&rdquo;
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionDraft(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.label}
                      onClick={() =>
                        setSelectionDraft((prev) => (prev ? { ...prev, color: c.id } : prev))
                      }
                      className={`h-5 w-5 rounded-full ${c.dotClass} transition ${
                        selectionDraft.color === c.id
                          ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-[#14171F]'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>

                <input
                  value={selectionDraft.noteText}
                  onChange={(e) =>
                    setSelectionDraft((prev) =>
                      prev ? { ...prev, noteText: e.target.value } : prev
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveSelectionAnnotation();
                    }
                  }}
                  placeholder="Add a note (optional)..."
                  className="min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                />

                <button
                  type="button"
                  disabled={savingAnnotation}
                  onClick={handleSaveSelectionAnnotation}
                  className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingAnnotation ? 'Saving...' : 'Save Highlight'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Collapsible Sidebar: Annotations & Contents/Search */}
        {sidebarOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-full shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl lg:static lg:shadow-none dark:border-slate-800 dark:bg-[#14171F]">
            <div className="flex items-center border-b border-slate-200 p-2 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSidebarTab('annotations')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium transition ${
                  sidebarTab === 'annotations'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <Highlighter className="h-3.5 w-3.5" />
                Annotations ({annotations.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('toc')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium transition ${
                  sidebarTab === 'toc'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <List className="h-3.5 w-3.5" />
                Contents &amp; Search
              </button>
            </div>

            {sidebarTab === 'annotations' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* Quick Note Composer */}
                {quickNoteOpen && (
                  <div className="border-b border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span>
                        New Note ({format === 'pdf' ? `Page ${currentPage}` : `Section ${currentPage}`})
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuickNoteOpen(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={quickNoteText}
                      onChange={(e) => setQuickNoteText(e.target.value)}
                      placeholder="Write your thoughts or summary for this page..."
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {COLOR_SWATCHES.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setQuickNoteColor(c.id)}
                            className={`h-4 w-4 rounded-full ${c.dotClass} ${
                              quickNoteColor === c.id
                                ? 'ring-2 ring-slate-900 ring-offset-1 dark:ring-white'
                                : 'opacity-65'
                            }`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={savingAnnotation || !quickNoteText.trim()}
                        onClick={handleSaveQuickNote}
                        className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save Note
                      </button>
                    </div>
                  </div>
                )}

                {/* Annotation Filter Bar */}
                <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={annotationSearch}
                      onChange={(e) => setAnnotationSearch(e.target.value)}
                      placeholder="Filter highlights & notes..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setColorFilter('all')}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                        colorFilter === 'all'
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      All
                    </button>
                    {COLOR_SWATCHES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={`Filter ${c.label}`}
                        onClick={() => setColorFilter((prev) => (prev === c.id ? 'all' : c.id))}
                        className={`flex h-6 w-6 items-center justify-center rounded-lg border ${
                          colorFilter === c.id
                            ? 'border-slate-900 bg-slate-100 dark:border-white dark:bg-slate-800'
                            : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className={`h-3 w-3 rounded-full ${c.dotClass}`} />
                      </button>
                    ))}
                    {currentPageAnnotations.length > 0 && (
                      <span className="ml-auto text-[10px] font-medium text-slate-400 tabular-nums">
                        {currentPageAnnotations.length} here
                      </span>
                    )}
                  </div>
                </div>

                {/* Annotations List */}
                <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                  {filteredAnnotations.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      <Highlighter className="mx-auto mb-2 h-7 w-7 opacity-40" />
                      <p className="font-medium text-slate-500">No annotations yet</p>
                      <p className="mt-1 px-4 leading-relaxed">
                        Select text while reading to highlight it, or click &ldquo;Add Note&rdquo;.
                        Export all notes to Markdown anytime.
                      </p>
                    </div>
                  ) : (
                    filteredAnnotations.map((ann) => {
                      const cm = getColorMeta(ann.color);
                      const isEditing = editingAnnId === ann.id;
                      const isFocused = highlightedAnnId === ann.id;
                      return (
                        <div
                          key={ann.id}
                          className={`rounded-xl border border-slate-200 border-l-4 ${cm.borderClass} bg-white p-3 text-xs transition dark:border-slate-800 dark:bg-slate-900/40 ${
                            isFocused ? 'ring-2 ring-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                goToPage(ann.pageNumber);
                                setHighlightedAnnId(ann.id);
                              }}
                              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${cm.badgeClass}`}
                            >
                              {format === 'pdf' ? `p.${ann.pageNumber}` : `Sec ${ann.pageNumber}`}
                              {ann.chapterTitle ? ` · ${ann.chapterTitle.slice(0, 20)}` : ''}
                            </button>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="Edit note"
                                onClick={() => {
                                  setEditingAnnId(ann.id);
                                  setEditingNoteDraft(ann.noteText || '');
                                  setEditingColorDraft(ann.color);
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                              >
                                <PenLine className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                title="Delete annotation"
                                onClick={() => setDeleteAnnTarget(ann)}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {ann.quoteText && (
                            <button
                              type="button"
                              onClick={() => goToPage(ann.pageNumber)}
                              className="mt-2 block w-full text-left italic leading-relaxed text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                            >
                              &ldquo;{ann.quoteText}&rdquo;
                            </button>
                          )}

                          {isEditing ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                rows={2}
                                value={editingNoteDraft}
                                onChange={(e) => setEditingNoteDraft(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                              />
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  {COLOR_SWATCHES.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => setEditingColorDraft(c.id)}
                                      className={`h-3.5 w-3.5 rounded-full ${c.dotClass} ${
                                        editingColorDraft === c.id
                                          ? 'ring-2 ring-slate-900 ring-offset-1 dark:ring-white'
                                          : 'opacity-60'
                                      }`}
                                    />
                                  ))}
                                </div>
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setEditingAnnId(null)}
                                    className="rounded-md px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditedAnnotation(ann)}
                                    className="rounded-md bg-blue-600 px-2.5 py-0.5 text-[11px] font-medium text-white"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            ann.noteText && (
                              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200">
                                {ann.noteText}
                              </p>
                            )
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              /* Contents & Full-Book Search Tab */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={bookSearchQuery}
                      onChange={(e) => setBookSearchQuery(e.target.value)}
                      placeholder="Search inside book..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto p-3 text-xs">
                  {bookSearchQuery.trim().length >= 2 ? (
                    bookSearchMatches.length === 0 ? (
                      <p className="py-8 text-center text-slate-400">No matches found.</p>
                    ) : (
                      bookSearchMatches.map((m, idx) => (
                        <button
                          key={`${m.pageNumber}-${idx}`}
                          type="button"
                          onClick={() => goToPage(m.pageNumber)}
                          className="w-full rounded-xl border border-slate-200 p-2.5 text-left hover:border-blue-500 dark:border-slate-800"
                        >
                          <p className="font-mono text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                            {m.title}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-300">
                            &hellip;{m.snippet}&hellip;
                          </p>
                        </button>
                      ))
                    )
                  ) : format === 'epub' && parsedEpub ? (
                    parsedEpub.chapters.map((ch) => (
                      <button
                        key={ch.index}
                        type="button"
                        onClick={() => goToPage(ch.index)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                          currentPage === ch.index
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate">{ch.title}</span>
                        <span className="font-mono text-[10px] opacity-60 tabular-nums">
                          {ch.index}
                        </span>
                      </button>
                    ))
                  ) : pdfOutline.length > 0 ? (
                    pdfOutline.map((item, idx) => (
                      <button
                        key={`${item.pageNumber}-${idx}`}
                        type="button"
                        onClick={() => goToPage(item.pageNumber)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                          currentPage === item.pageNumber
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate">{item.title}</span>
                        <span className="font-mono text-[10px] opacity-60 tabular-nums">
                          p.{item.pageNumber}
                        </span>
                      </button>
                    ))
                  ) : (
                    Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => goToPage(pg)}
                        className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left transition ${
                          currentPage === pg
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="font-mono">Page {pg}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Bottom Reading Progress Bar */}
      <div className="flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-2 text-[11px] dark:border-slate-800 dark:bg-[#14171F]">
        <span className="shrink-0 font-mono text-slate-500 tabular-nums">
          {format === 'pdf' ? `Page ${currentPage}` : `Section ${currentPage}`} / {totalPages}
        </span>
        <input
          type="range"
          min={1}
          max={Math.max(1, totalPages)}
          value={currentPage}
          onChange={(e) => goToPage(Number(e.target.value))}
          aria-label="Reading progress slider"
          className="h-1.5 flex-1 cursor-pointer accent-blue-600"
        />
        <span className="shrink-0 font-mono font-medium text-slate-600 tabular-nums dark:text-slate-300">
          {progressPercent}% read
        </span>
      </div>

      {/* Delete Annotation Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteAnnTarget)}
        onOpenChange={(open) => !open && setDeleteAnnTarget(null)}
        title="Delete annotation?"
        description="This will permanently remove the highlight and note from this book."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteAnnotationConfirmed}
      />
    </div>
  );
};
