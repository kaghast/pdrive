import JSZip from 'jszip';
import {
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  UploadCloud,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { formatBytes } from '../../lib/utils';
import { CloudFile } from '../../providers/StorageProvider';

interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
}

type DocxBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; runs: DocxRun[] }
  | { type: 'paragraph'; runs: DocxRun[]; isList?: boolean }
  | { type: 'table'; rows: string[][] };

function extractRuns(node: Element): DocxRun[] {
  const runs: DocxRun[] = [];
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const localName = el.localName;

    if (localName === 'r') {
      const rPr = Array.from(el.children).find((c) => c.localName === 'rPr');
      const bold = Boolean(rPr && Array.from(rPr.children).some((c) => c.localName === 'b'));
      const italic = Boolean(rPr && Array.from(rPr.children).some((c) => c.localName === 'i'));
      const underline = Boolean(rPr && Array.from(rPr.children).some((c) => c.localName === 'u'));

      let text = '';
      for (const rc of Array.from(el.children)) {
        if (rc.localName === 't') text += rc.textContent || '';
        else if (rc.localName === 'tab') text += '    ';
        else if (rc.localName === 'br') text += '\n';
      }
      if (text) {
        runs.push({ text, bold, italic, underline });
      }
    } else if (localName === 'hyperlink') {
      runs.push(...extractRuns(el));
    }
  }
  return runs;
}

async function parseDocxBlob(blob: Blob): Promise<DocxBlock[]> {
  const zip = await JSZip.loadAsync(blob);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Could not find word/document.xml inside this .docx archive.');
  }

  const xmlText = await docFile.async('text');
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  const parserErr = xml.querySelector('parsererror');
  if (parserErr) {
    throw new Error('Failed to parse document XML.');
  }

  const body = Array.from(xml.documentElement.children).find((c) => c.localName === 'body');
  if (!body) return [];

  const blocks: DocxBlock[] = [];

  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') {
      const pPr = Array.from(child.children).find((c) => c.localName === 'pPr');
      const pStyle = pPr
        ? Array.from(pPr.children).find((c) => c.localName === 'pStyle')?.getAttribute('w:val') ||
          Array.from(pPr.children).find((c) => c.localName === 'pStyle')?.getAttribute('val') ||
          ''
        : '';
      const numPr = pPr ? Array.from(pPr.children).find((c) => c.localName === 'numPr') : null;
      const runs = extractRuns(child);
      const plain = runs.map((r) => r.text).join('').trim();

      if (!plain) continue;

      const styleLower = pStyle.toLowerCase();
      if (styleLower.includes('title') || styleLower === 'heading1' || styleLower === '1') {
        blocks.push({ type: 'heading', level: 1, runs });
      } else if (styleLower === 'heading2' || styleLower === '2') {
        blocks.push({ type: 'heading', level: 2, runs });
      } else if (styleLower === 'heading3' || styleLower === '3') {
        blocks.push({ type: 'heading', level: 3, runs });
      } else if (styleLower === 'heading4' || styleLower === '4') {
        blocks.push({ type: 'heading', level: 4, runs });
      } else {
        blocks.push({ type: 'paragraph', runs, isList: Boolean(numPr) });
      }
    } else if (child.localName === 'tbl') {
      const rows: string[][] = [];
      for (const tr of Array.from(child.children)) {
        if (tr.localName !== 'tr') continue;
        const rowCells: string[] = [];
        for (const tc of Array.from(tr.children)) {
          if (tc.localName !== 'tc') continue;
          const cellTexts: string[] = [];
          for (const p of Array.from(tc.children)) {
            if (p.localName === 'p') {
              const t = extractRuns(p).map((r) => r.text).join('').trim();
              if (t) cellTexts.push(t);
            }
          }
          rowCells.push(cellTexts.join(' '));
        }
        if (rowCells.length > 0) rows.push(rowCells);
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
    }
  }

  return blocks;
}

function blocksToMarkdown(blocks: DocxBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'heading') {
        const prefix = '#'.repeat(b.level);
        return `${prefix} ${b.runs.map((r) => r.text).join('')}`;
      }
      if (b.type === 'paragraph') {
        const text = b.runs
          .map((r) => {
            let t = r.text;
            if (r.bold) t = `**${t}**`;
            if (r.italic) t = `*${t}*`;
            return t;
          })
          .join('');
        return b.isList ? `- ${text}` : text;
      }
      if (b.type === 'table' && b.rows.length > 0) {
        const header = `| ${b.rows[0].join(' | ')} |`;
        const sep = `| ${b.rows[0].map(() => '---').join(' | ')} |`;
        const body = b.rows.slice(1).map((r) => `| ${r.join(' | ')} |`);
        return [header, sep, ...body].join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export const DocxViewer: React.FC<{ file: CloudFile }> = ({ file }) => {
  const {
    storageProvider,
    microsoftStatus,
    startWordOnlineSession,
    openNewAppWindow,
    currentFolderId,
    setActiveNav,
    setActiveWindowId,
  } = useDriveOS();

  const [blocks, setBlocks] = useState<DocxBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    storageProvider
      .downloadBlob(file.id)
      .then(async (blob) => {
        if (!active) return;
        setRawBlob(blob);
        const parsed = await parseDocxBlob(blob);
        if (active) setBlocks(parsed);
      })
      .catch((err) => {
        if (active) setError(err?.message || 'Unable to parse .docx document.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [file.id, storageProvider]);

  const markdownPreview = useMemo(() => blocksToMarkdown(blocks), [blocks]);

  const handleDownload = () => {
    if (!rawBlob) return;
    const url = URL.createObjectURL(rawBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded "${file.name}"`);
  };

  const handleConvertToMarkdown = () => {
    const baseName = file.name.replace(/\.(docx?|DOCX?)$/, '');
    openNewAppWindow({
      appId: 'markdown',
      title: `${baseName}.md`,
      initialContent: markdownPreview || `# ${baseName}\n\n`,
      targetFolderId: file.parents?.[0] || currentFolderId,
    });
    toast.success('Converted document to Markdown Studio (save to Google Drive when ready).');
  };

  const renderRuns = (runs: DocxRun[]) =>
    runs.map((r, i) => (
      <span
        key={i}
        className={`${r.bold ? 'font-semibold' : ''} ${r.italic ? 'italic' : ''} ${
          r.underline ? 'underline underline-offset-2' : ''
        }`}
      >
        {r.text}
      </span>
    ));

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[540px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {file.name}
            </h3>
            <p className="text-xs text-slate-500 tabular-nums">
              Built-in DOCX Viewer · {formatBytes(file.size)} · No Microsoft Admin required
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading || blocks.length === 0}
            onClick={handleConvertToMarkdown}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <FileCode2 className="h-3.5 w-3.5" />
            Edit as Markdown
          </button>

          {file.webViewLink && (
            <a
              href={file.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Google Docs
            </a>
          )}

          {microsoftStatus.connected ? (
            <button
              type="button"
              onClick={() => startWordOnlineSession(file)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              Word Online
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setActiveNav('settings');
                setActiveWindowId(null);
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Word Online Setup
            </button>
          )}

          <button
            type="button"
            disabled={!rawBlob}
            onClick={handleDownload}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      </div>

      {/* Document Page Canvas */}
      <div className="flex-1 overflow-y-auto bg-slate-100/70 p-4 sm:p-8 dark:bg-[#0B0D11]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Reading Word document...
          </div>
        ) : error ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Preview unavailable for this file format
            </p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{error}</p>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              Legacy binary .doc files can be opened directly in Google Docs or downloaded.
            </p>
          </div>
        ) : blocks.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#14171F]">
            This document appears to be empty.
          </div>
        ) : (
          <article className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-xs sm:p-12 dark:border-slate-800 dark:bg-[#14171F]">
            {blocks.map((block, idx) => {
              if (block.type === 'heading') {
                const sizeCls =
                  block.level === 1
                    ? 'text-2xl font-bold pt-2'
                    : block.level === 2
                      ? 'text-xl font-semibold pt-2'
                      : block.level === 3
                        ? 'text-lg font-semibold pt-1'
                        : 'text-base font-semibold';
                return (
                  <div
                    key={idx}
                    className={`font-display text-slate-900 dark:text-slate-100 ${sizeCls}`}
                  >
                    {renderRuns(block.runs)}
                  </div>
                );
              }
              if (block.type === 'paragraph') {
                return (
                  <p
                    key={idx}
                    className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${
                      block.isList ? 'pl-5 before:mr-2 before:content-["•"]' : ''
                    }`}
                  >
                    {renderRuns(block.runs)}
                  </p>
                );
              }
              if (block.type === 'table') {
                return (
                  <div key={idx} className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full border-collapse text-left text-xs">
                      <tbody>
                        {block.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={`border-b border-slate-200 last:border-b-0 dark:border-slate-700 ${
                              rIdx === 0 ? 'bg-slate-50 font-semibold dark:bg-slate-800/60' : ''
                            }`}
                          >
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="border-r border-slate-200 px-3 py-2 last:border-r-0 dark:border-slate-700">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              return null;
            })}
          </article>
        )}
      </div>
    </div>
  );
};
