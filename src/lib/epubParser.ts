import JSZip from 'jszip';

export interface EpubChapter {
  index: number; // 1-based spine index
  idref: string;
  href: string;
  title: string;
  html: string;
  plainText: string;
}

export interface ParsedEpub {
  title: string;
  author: string;
  chapters: EpubChapter[];
  cleanup: () => void;
}

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface EbookAnnotationItem {
  id: string;
  fileId: string;
  fileName: string;
  format: 'epub' | 'pdf';
  pageNumber: number;
  chapterTitle: string | null;
  quoteText: string;
  noteText: string;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
}

export interface EbookReadingStateItem {
  id?: number;
  fileId: string;
  fileName: string;
  format: 'epub' | 'pdf';
  currentLocation: string;
  currentPage: number;
  totalPages: number;
  scrollPercent: number;
  progressPercent: number;
  bookTitle: string | null;
  bookAuthor: string | null;
  lastReadAt?: string;
}

function normalizeZipPath(baseDir: string, relativePath: string): string {
  const cleanRel = decodeURIComponent(relativePath.split('#')[0].split('?')[0]).trim();
  if (!cleanRel) return '';
  const raw = cleanRel.startsWith('/')
    ? cleanRel.slice(1)
    : baseDir
      ? `${baseDir}/${cleanRel}`
      : cleanRel;

  const parts = raw.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function getDirName(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

function findZipFile(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  if (!targetPath) return null;
  const direct = zip.file(targetPath);
  if (direct) return direct;
  const lower = targetPath.toLowerCase();
  const match = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
  return match ? zip.file(match) : null;
}

function getFirstTextByLocalName(root: Document | Element, localName: string): string {
  const els = root.getElementsByTagName('*');
  for (let i = 0; i < els.length; i++) {
    if (els[i].localName?.toLowerCase() === localName.toLowerCase()) {
      const txt = els[i].textContent?.trim();
      if (txt) return txt;
    }
  }
  return '';
}

function getElementsByLocalName(root: Document | Element, localName: string): Element[] {
  const out: Element[] = [];
  const els = root.getElementsByTagName('*');
  for (let i = 0; i < els.length; i++) {
    if (els[i].localName?.toLowerCase() === localName.toLowerCase()) {
      out.push(els[i]);
    }
  }
  return out;
}

export async function parseEpubArchive(buffer: ArrayBuffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();
  const objectUrls: string[] = [];
  const assetUrlCache = new Map<string, string>();

  const getAssetBlobUrl = async (zipPath: string, fallbackMime?: string): Promise<string | null> => {
    if (!zipPath) return null;
    if (assetUrlCache.has(zipPath)) return assetUrlCache.get(zipPath)!;
    const entry = findZipFile(zip, zipPath);
    if (!entry) return null;
    const bytes = await entry.async('uint8array');
    const ext = zipPath.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      css: 'text/css',
    };
    const blob = new Blob([new Uint8Array(bytes)], {
      type: mimeMap[ext] || fallbackMime || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    assetUrlCache.set(zipPath, url);
    return url;
  };

  // 1. Locate OPF via META-INF/container.xml
  let opfPath = '';
  const containerEntry = findZipFile(zip, 'META-INF/container.xml');
  if (containerEntry) {
    const containerXml = await containerEntry.async('string');
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfiles = getElementsByLocalName(containerDoc, 'rootfile');
    opfPath = rootfiles[0]?.getAttribute('full-path') || '';
  }

  if (!opfPath) {
    const fallbackOpf = Object.keys(zip.files).find((k) => k.toLowerCase().endsWith('.opf'));
    if (!fallbackOpf) {
      throw new Error('Invalid EPUB: missing container.xml and OPF package manifest.');
    }
    opfPath = fallbackOpf;
  }

  const opfEntry = findZipFile(zip, opfPath);
  if (!opfEntry) {
    throw new Error(`Invalid EPUB: OPF manifest not found at "${opfPath}".`);
  }
  const opfBaseDir = getDirName(opfPath);
  const opfXml = await opfEntry.async('string');
  const opfDoc = parser.parseFromString(opfXml, 'application/xml');

  const bookTitle = getFirstTextByLocalName(opfDoc, 'title') || 'Untitled Book';
  const bookAuthor = getFirstTextByLocalName(opfDoc, 'creator') || '';

  // 2. Build manifest map
  const manifest = new Map<
    string,
    { id: string; href: string; fullPath: string; mediaType: string; properties: string }
  >();
  for (const item of getElementsByLocalName(opfDoc, 'item')) {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || '';
    if (id && href) {
      manifest.set(id, {
        id,
        href,
        fullPath: normalizeZipPath(opfBaseDir, href),
        mediaType,
        properties,
      });
    }
  }

  // 3. Build TOC title map from EPUB3 nav or EPUB2 toc.ncx
  const tocTitleByPath = new Map<string, string>();
  const navItem = Array.from(manifest.values()).find((m) =>
    m.properties.split(/\s+/).includes('nav')
  );
  if (navItem) {
    const navEntry = findZipFile(zip, navItem.fullPath);
    if (navEntry) {
      const navText = await navEntry.async('string');
      const navDoc = parser.parseFromString(navText, 'text/html');
      const navDir = getDirName(navItem.fullPath);
      const links = Array.from(navDoc.querySelectorAll('nav a[href]'));
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const target = normalizeZipPath(navDir, href);
        const label = a.textContent?.replace(/\s+/g, ' ').trim();
        if (target && label && !tocTitleByPath.has(target)) {
          tocTitleByPath.set(target, label);
        }
      }
    }
  }

  if (tocTitleByPath.size === 0) {
    const spineEl = getElementsByLocalName(opfDoc, 'spine')[0];
    const tocId = spineEl?.getAttribute('toc') || '';
    const ncxItem =
      (tocId ? manifest.get(tocId) : undefined) ||
      Array.from(manifest.values()).find((m) => m.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncxEntry = findZipFile(zip, ncxItem.fullPath);
      if (ncxEntry) {
        const ncxXml = await ncxEntry.async('string');
        const ncxDoc = parser.parseFromString(ncxXml, 'application/xml');
        const ncxDir = getDirName(ncxItem.fullPath);
        for (const navPoint of getElementsByLocalName(ncxDoc, 'navPoint')) {
          const label = getFirstTextByLocalName(navPoint, 'text');
          const contentEl = getElementsByLocalName(navPoint, 'content')[0];
          const src = contentEl?.getAttribute('src') || '';
          const target = normalizeZipPath(ncxDir, src);
          if (target && label && !tocTitleByPath.has(target)) {
            tocTitleByPath.set(target, label.replace(/\s+/g, ' ').trim());
          }
        }
      }
    }
  }

  // 4. Read spine items
  const spineRefs = getElementsByLocalName(opfDoc, 'itemref');
  const spineItems = spineRefs
    .map((ref) => {
      const idref = ref.getAttribute('idref') || '';
      return manifest.get(idref);
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  const fallbackHtmlItems =
    spineItems.length > 0
      ? spineItems
      : Array.from(manifest.values()).filter(
          (m) => m.mediaType.includes('html') || /\.(xhtml|html|htm)$/i.test(m.fullPath)
        );

  const chapters: EpubChapter[] = [];
  for (let i = 0; i < fallbackHtmlItems.length; i++) {
    const item = fallbackHtmlItems[i];
    const entry = findZipFile(zip, item.fullPath);
    if (!entry) continue;
    const rawHtml = await entry.async('string');
    const chapterDir = getDirName(item.fullPath);

    // Parse as HTML for resilient rendering across XHTML/HTML4/HTML5
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Remove unsafe or interfering tags
    doc.querySelectorAll('script, noscript, iframe, object, embed').forEach((el) => el.remove());

    // Strip inline event handlers & javascript: URLs
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      }
      const href = el.getAttribute('href');
      if (href && href.trim().toLowerCase().startsWith('javascript:')) {
        el.removeAttribute('href');
      }
    });

    // Rewrite images to Blob URLs
    const images = Array.from(doc.querySelectorAll('img'));
    for (const img of images) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('http')) {
        const assetPath = normalizeZipPath(chapterDir, src);
        const blobUrl = await getAssetBlobUrl(assetPath);
        if (blobUrl) {
          img.setAttribute('src', blobUrl);
        }
      }
    }

    // Rewrite SVG <image> xlink:href / href inside SVG cover wrappers
    const svgImages = Array.from(doc.querySelectorAll('image'));
    for (const svgImg of svgImages) {
      const href = svgImg.getAttribute('xlink:href') || svgImg.getAttribute('href');
      if (href && !href.startsWith('data:') && !href.startsWith('http')) {
        const assetPath = normalizeZipPath(chapterDir, href);
        const blobUrl = await getAssetBlobUrl(assetPath);
        if (blobUrl) {
          svgImg.setAttribute('href', blobUrl);
          if (svgImg.hasAttribute('xlink:href')) {
            svgImg.setAttribute('xlink:href', blobUrl);
          }
        }
      }
    }

    const bodyEl = doc.body || doc.documentElement;
    const headingText =
      doc.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim() ||
      doc.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() ||
      '';
    const title = tocTitleByPath.get(item.fullPath) || headingText || `Section ${chapters.length + 1}`;
    const plainText = (bodyEl?.textContent || '').replace(/\s+/g, ' ').trim();

    chapters.push({
      index: chapters.length + 1,
      idref: item.id,
      href: item.fullPath,
      title,
      html: bodyEl ? bodyEl.innerHTML : rawHtml,
      plainText,
    });
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract readable chapters from this EPUB file.');
  }

  return {
    title: bookTitle,
    author: bookAuthor,
    chapters,
    cleanup: () => {
      for (const u of objectUrls) {
        URL.revokeObjectURL(u);
      }
    },
  };
}

const COLOR_LABELS: Record<AnnotationColor, string> = {
  yellow: 'Yellow Highlight',
  green: 'Green Highlight',
  blue: 'Blue Highlight',
  pink: 'Pink Highlight',
};

export function buildAnnotationsMarkdown(params: {
  bookTitle: string;
  bookAuthor?: string | null;
  fileName: string;
  format: 'epub' | 'pdf';
  progressPercent: number;
  annotations: EbookAnnotationItem[];
}): string {
  const { bookTitle, bookAuthor, fileName, format, progressPercent, annotations } = params;
  const exportedAt = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `# ${bookTitle || fileName} — Reading Notes & Highlights`,
    '',
    `- **Source File:** \`${fileName}\``,
    `- **Format:** ${format.toUpperCase()}`,
  ];

  if (bookAuthor) {
    lines.push(`- **Author:** ${bookAuthor}`);
  }
  lines.push(`- **Reading Progress:** ${progressPercent}%`);
  lines.push(`- **Total Annotations:** ${annotations.length}`);
  lines.push(`- **Exported:** ${exportedAt}`);
  lines.push('', '---', '');

  if (annotations.length === 0) {
    lines.push('_No highlights or notes recorded yet._', '');
    return lines.join('\n');
  }

  // Group by pageNumber + chapterTitle in reading order
  const sorted = [...annotations].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const groups = new Map<string, EbookAnnotationItem[]>();
  for (const ann of sorted) {
    const label =
      format === 'pdf'
        ? `Page ${ann.pageNumber}${ann.chapterTitle ? ` — ${ann.chapterTitle}` : ''}`
        : ann.chapterTitle
          ? `${ann.chapterTitle} (Section ${ann.pageNumber})`
          : `Section ${ann.pageNumber}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(ann);
  }

  for (const [sectionLabel, items] of groups.entries()) {
    lines.push(`## ${sectionLabel}`, '');
    for (const item of items) {
      const colorLabel = COLOR_LABELS[item.color] || item.color;
      const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
      lines.push(`### ${colorLabel}${dateStr ? ` · ${dateStr}` : ''}`, '');
      if (item.quoteText.trim()) {
        const quoted = item.quoteText
          .trim()
          .split(/\r?\n/)
          .map((l) => `> ${l}`)
          .join('\n');
        lines.push(quoted, '');
      }
      if (item.noteText.trim()) {
        lines.push(`**Note:** ${item.noteText.trim()}`, '');
      }
    }
  }

  return lines.join('\n');
}
