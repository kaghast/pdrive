import { CloudFile } from '../providers/StorageProvider';
import { getFileExtension } from './utils';

export type IntegratedAppId =
  | 'folder'
  | 'markdown'
  | 'pdf'
  | 'ebook'
  | 'archive'
  | 'excalidraw'
  | 'drawio'
  | 'mermaid'
  | 'sqlite'
  | 'docx-viewer'
  | 'word-online'
  | 'excel-online'
  | 'powerpoint-online'
  | 'google-docs-export'
  | 'image'
  | 'code'
  | 'external';

export interface AppHandlerOption {
  id: IntegratedAppId;
  label: string;
  description: string;
}

export const INTEGRATED_APPS: Record<IntegratedAppId, AppHandlerOption> = {
  folder: { id: 'folder', label: 'Folder Explorer', description: 'Browse folder contents' },
  markdown: { id: 'markdown', label: 'Markdown Studio', description: 'Split editor with GFM, KaTeX & Mermaid' },
  pdf: { id: 'pdf', label: 'PDF Studio', description: 'PDF.js viewer & PDF-lib page editor' },
  ebook: { id: 'ebook', label: 'E-Book Reader', description: 'Read EPUB & PDF with highlights, resume & Markdown export' },
  archive: { id: 'archive', label: 'Archive Manager', description: 'Inspect, extract, and create ZIPs' },
  excalidraw: { id: 'excalidraw', label: 'Excalidraw', description: 'Freehand visual diagram editor' },
  drawio: { id: 'drawio', label: 'Draw.io', description: 'Technical architecture & UML diagrams' },
  mermaid: { id: 'mermaid', label: 'Mermaid Studio', description: 'Code-driven flow & sequence diagrams' },
  sqlite: { id: 'sqlite', label: 'SQLite Studio', description: 'Create, browse, query & edit SQLite databases' },
  'docx-viewer': { id: 'docx-viewer', label: 'Built-in DOCX Viewer', description: 'Read & convert Word files without Microsoft Azure' },
  'word-online': { id: 'word-online', label: 'Microsoft Word Online', description: 'Real Word Online via temporary OneDrive sync' },
  'excel-online': { id: 'excel-online', label: 'Microsoft Excel Online', description: 'Open spreadsheet in web viewer' },
  'powerpoint-online': { id: 'powerpoint-online', label: 'Microsoft PowerPoint Online', description: 'Open presentation in web viewer' },
  'google-docs-export': { id: 'google-docs-export', label: 'PDF Export Preview', description: 'Export Google Doc or Slide as PDF' },
  image: { id: 'image', label: 'Image Viewer', description: 'Inspect and zoom images' },
  code: { id: 'code', label: 'Code & Text Editor', description: 'Edit plain text and source code' },
  external: { id: 'external', label: 'Open in Google Drive', description: 'Open native file in Google Drive web' },
};

export function getCompatibleApps(file: CloudFile): AppHandlerOption[] {
  if (file.isFolder) return [INTEGRATED_APPS.folder];

  const ext = getFileExtension(file.name);
  const mime = file.mimeType.toLowerCase();

  if (mime === 'application/vnd.google-apps.document') {
    return [
      INTEGRATED_APPS['word-online'],
      INTEGRATED_APPS['google-docs-export'],
      INTEGRATED_APPS.external,
    ];
  }
  if (mime === 'application/vnd.google-apps.presentation') {
    return [INTEGRATED_APPS['google-docs-export'], INTEGRATED_APPS.external];
  }
  if (file.isGoogleWorkspaceDoc) {
    return [INTEGRATED_APPS.external, INTEGRATED_APPS['google-docs-export']];
  }

  if (ext === '.docx' || ext === '.doc' || mime.includes('wordprocessingml')) {
    return [INTEGRATED_APPS['word-online'], INTEGRATED_APPS['docx-viewer'], INTEGRATED_APPS.external];
  }
  if (ext === '.md' || ext === '.markdown' || mime === 'text/markdown') {
    return [INTEGRATED_APPS.markdown, INTEGRATED_APPS.code];
  }
  if (ext === '.pdf' || mime === 'application/pdf') {
    return [INTEGRATED_APPS.pdf, INTEGRATED_APPS.ebook, INTEGRATED_APPS.external];
  }
  if (ext === '.epub' || mime === 'application/epub+zip') {
    return [INTEGRATED_APPS.ebook];
  }
  if (ext === '.zip' || ext === '.rar' || mime.includes('zip')) {
    return [INTEGRATED_APPS.archive];
  }
  if (ext === '.excalidraw') {
    return [INTEGRATED_APPS.excalidraw, INTEGRATED_APPS.code];
  }
  if (ext === '.drawio') {
    return [INTEGRATED_APPS.drawio, INTEGRATED_APPS.code];
  }
  if (ext === '.mmd' || ext === '.mermaid') {
    return [INTEGRATED_APPS.mermaid, INTEGRATED_APPS.code];
  }
  if (
    ['.sqlite', '.sqlite3', '.db'].includes(ext) ||
    mime.includes('sqlite')
  ) {
    return [INTEGRATED_APPS.sqlite];
  }
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
    return [INTEGRATED_APPS.image, ...(ext === '.svg' ? [INTEGRATED_APPS.code] : [])];
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    ['.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.yml', '.yaml', '.xml'].includes(ext)
  ) {
    return [INTEGRATED_APPS.code, INTEGRATED_APPS.markdown];
  }
  return [INTEGRATED_APPS.external, INTEGRATED_APPS.code];
}

export function resolveOpenWithApp(
  file: CloudFile,
  preferences?: Record<string, string>
): IntegratedAppId {
  if (file.isFolder) return 'folder';

  const ext = getFileExtension(file.name);
  if (preferences && ext && preferences[ext]) {
    const preferred = preferences[ext] as IntegratedAppId;
    if (INTEGRATED_APPS[preferred]) {
      return preferred;
    }
  }

  const compatible = getCompatibleApps(file);
  return compatible[0]?.id || 'external';
}
