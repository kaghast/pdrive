import {
  Archive,
  BookOpen,
  ChevronRight,
  Clock,
  Database,
  FileCode2,
  FileText,
  FolderOpen,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { ActiveNavView, useDriveOS, WorkspaceWindow } from '../../contexts/DriveOSContext';
import { DashboardView } from '../dashboard/DashboardView';
import { ArchiveManager } from '../editors/ArchiveManager';
import { DiagramStudio } from '../editors/DiagramStudio';
import { DocxViewer } from '../editors/DocxViewer';
import { EbookReader } from '../editors/EbookReader';
import { MarkdownEditor } from '../editors/MarkdownEditor';
import { PdfStudio } from '../editors/PdfStudio';
import { CodeFileEditor, ImageViewer } from '../editors/QuickPreviewEditors';
import { SqliteStudio } from '../editors/SqliteStudio';
import { FileExplorerView } from '../explorer/FileExplorerView';
import { OfflineIndicator } from '../pwa/OfflineIndicator';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { SettingsView } from '../settings/SettingsView';
import { WordSyncView } from '../word/WordSyncView';

const NAV_ITEMS: { id: ActiveNavView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'explorer', label: 'My Drive', icon: FolderOpen },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'trash', label: 'Trash', icon: Trash2 },
  { id: 'word-sync', label: 'Word Sync', icon: RefreshCw },
  { id: 'apps', label: 'Apps', icon: Workflow },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const DriveOSShell: React.FC = () => {
  const {
    firebaseUser,
    signOut,
    settings,
    updateSettings,
    wordSessions,
    activeNav,
    setActiveNav,
    currentFolderId,
    setCurrentFolderId,
    allFolders,
    windows,
    activeWindowId,
    setActiveWindowId,
    closeWindow,
    renameWindowFile,
    openNewAppWindow,
  } = useDriveOS();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabValue, setEditingTabValue] = useState('');
  const tabInputRef = useRef<HTMLInputElement>(null);

  const pendingSyncCount = wordSessions.filter((s) => s.status !== 'completed').length;
  const activeWindow = windows.find((w) => w.id === activeWindowId) || null;

  const activeWindowBreadcrumbs = useMemo(() => {
    if (!activeWindow) return [];
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));
    const rawParent = activeWindow.file?.parents?.[0] || activeWindow.targetFolderId || 'root';
    let cursor: string | undefined = folderMap.has(rawParent) ? rawParent : 'root';
    const trail: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    while (cursor && cursor !== 'root' && !seen.has(cursor) && trail.length < 12) {
      seen.add(cursor);
      const node = folderMap.get(cursor);
      if (!node) break;
      trail.unshift({ id: node.id, name: node.name });
      cursor = node.parents?.[0];
    }
    return [{ id: 'root', name: 'My Drive' }, ...trail];
  }, [activeWindow, allFolders]);

  const startTabRename = (w: WorkspaceWindow) => {
    setEditingTabId(w.id);
    setEditingTabValue(w.title);
    requestAnimationFrame(() => {
      const input = tabInputRef.current;
      if (!input) return;
      input.focus();
      const dotIdx = w.title.lastIndexOf('.');
      if (dotIdx > 0) input.setSelectionRange(0, dotIdx);
      else input.select();
    });
  };

  const commitTabRename = async (w: WorkspaceWindow) => {
    const nextName = editingTabValue.trim();
    setEditingTabId(null);
    if (!nextName || nextName === w.title) return;
    await renameWindowFile(w.id, nextName);
  };

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    updateSettings({ theme: isDark ? 'light' : 'dark' });
  };

  const handleNavClick = (id: ActiveNavView) => {
    setActiveNav(id);
    setActiveWindowId(null);
    setMobileDrawerOpen(false);
  };

  const renderWorkspaceWindow = (win: WorkspaceWindow) => {
    switch (win.appId) {
      case 'markdown':
        return (
          <MarkdownEditor
            key={win.id}
            file={win.file}
            initialContent={win.initialContent}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'pdf':
        return (
          <PdfStudio
            key={win.id}
            file={win.file}
            isGoogleExport={false}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'ebook':
        return (
          <EbookReader
            key={win.id}
            file={win.file}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'google-docs-export':
        return (
          <PdfStudio
            key={win.id}
            file={win.file}
            isGoogleExport={true}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'excalidraw':
        return (
          <DiagramStudio
            key={win.id}
            mode="excalidraw"
            file={win.file}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'drawio':
        return (
          <DiagramStudio
            key={win.id}
            mode="drawio"
            file={win.file}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'mermaid':
        return (
          <DiagramStudio
            key={win.id}
            mode="mermaid"
            file={win.file}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'archive':
        return (
          <ArchiveManager
            key={win.id}
            file={win.file}
            initialFileIdsToCompress={win.extraFileIds}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'sqlite':
        return (
          <SqliteStudio
            key={win.id}
            file={win.file}
            targetFolderId={win.targetFolderId}
          />
        );
      case 'docx-viewer':
        return win.file ? <DocxViewer key={win.id} file={win.file} /> : null;
      case 'code':
        return win.file ? <CodeFileEditor key={win.id} file={win.file} /> : null;
      case 'image':
        return win.file ? <ImageViewer key={win.id} file={win.file} /> : null;
      default:
        return null;
    }
  };

  const renderAppsLauncher = () => (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
          Integrated Apps
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Launch standalone document, PDF, diagram, and archive studios backed by Google Drive.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: 'Markdown Studio',
            desc: 'CodeMirror 6 split editor with GFM tables, task lists, KaTeX math, Mermaid diagrams, and PDF/HTML export.',
            icon: FileCode2,
            action: () =>
              openNewAppWindow({ appId: 'markdown', title: 'Untitled.md', targetFolderId: currentFolderId }),
          },
          {
            title: 'PDF Studio',
            desc: 'PDF.js viewer with search and PDF-lib page editing, merging, signatures, watermarks, and image conversion.',
            icon: FileText,
            action: () =>
              openNewAppWindow({ appId: 'pdf', title: 'Document.pdf', targetFolderId: currentFolderId }),
          },
          {
            title: 'E-Book Reader',
            desc: 'Read EPUB & PDF books from Google Drive with synced progress resume, highlights, notes, and Markdown export.',
            icon: BookOpen,
            action: () =>
              openNewAppWindow({ appId: 'ebook', title: 'E-Book Reader', targetFolderId: currentFolderId }),
          },
          {
            title: 'Excalidraw Canvas',
            desc: 'Freehand visual diagrams saved directly as .excalidraw source files in Google Drive with PNG/SVG/PDF export.',
            icon: Workflow,
            action: () =>
              openNewAppWindow({ appId: 'excalidraw', title: 'Diagram.excalidraw', targetFolderId: currentFolderId }),
          },
          {
            title: 'Draw.io Architect',
            desc: 'Structured technical flowcharts, cloud architecture, and UML diagrams saved as .drawio XML.',
            icon: Workflow,
            action: () =>
              openNewAppWindow({ appId: 'drawio', title: 'Architecture.drawio', targetFolderId: currentFolderId }),
          },
          {
            title: 'Mermaid Studio',
            desc: 'Code-driven flowcharts, sequence diagrams, class diagrams, and ER diagrams with live SVG/PNG export.',
            icon: Workflow,
            action: () =>
              openNewAppWindow({ appId: 'mermaid', title: 'Diagram.mmd', targetFolderId: currentFolderId }),
          },
          {
            title: 'SQLite Studio',
            desc: 'Create new .sqlite databases, edit tables and rows visually, run SQL queries, and sync directly with Google Drive.',
            icon: Database,
            action: () =>
              openNewAppWindow({ appId: 'sqlite', title: 'database.sqlite', targetFolderId: currentFolderId }),
          },
          {
            title: 'Archive Manager',
            desc: 'Inspect ZIP contents, safely extract to Google Drive, and compress folders while preserving structure.',
            icon: Archive,
            action: () => handleNavClick('explorer'),
          },
        ].map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.title}
              type="button"
              onClick={app.action}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 text-left transition hover:border-blue-500 dark:border-slate-800 dark:bg-[#14171F] dark:hover:border-blue-500"
            >
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-blue-600 dark:bg-slate-800 dark:text-blue-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {app.title}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {app.desc}
                </p>
              </div>
              <span className="mt-4 text-xs font-medium text-blue-600 dark:text-blue-400">
                Launch Studio
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const SidebarContent = () => (
    <div className="flex h-full flex-col justify-between p-4">
      <div>
        <div className="flex items-center gap-3 px-2 py-1.5">
          <img src="/icon.svg" alt="Personal Drive OS" className="h-7 w-7 rounded-lg" />
          <span className="font-display text-sm font-semibold tracking-tight text-slate-900 whitespace-nowrap dark:text-white">
            Personal Drive OS
          </span>
        </div>

        <nav className="mt-6 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = !activeWindow && activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`flex min-h-[42px] w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </span>
                {item.id === 'word-sync' && pendingSyncCount > 0 && (
                  <span className="font-mono text-[11px] font-semibold tabular-nums text-amber-500">
                    {pendingSyncCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="px-2">
          <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
            {firebaseUser?.displayName || firebaseUser?.email}
          </p>
          <p className="truncate text-[11px] text-slate-500">{firebaseUser?.email}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex min-h-[40px] w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-red-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] text-slate-900 dark:bg-[#0B0D11] dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-[#14171F]">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-white shadow-2xl dark:bg-[#14171F]">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileDrawerOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        {/* Compact OS Top Bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md lg:px-6 dark:border-slate-800 dark:bg-[#14171F]/90">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileDrawerOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Open App Window Tabs */}
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveNav('explorer');
                  setActiveWindowId(null);
                }}
                title="Switch to My Drive (keeps open file tabs alive)"
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  !activeWindowId && activeNav === 'explorer'
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <FolderOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>My Drive</span>
              </button>

              {activeNav !== 'explorer' && (
                <button
                  type="button"
                  onClick={() => setActiveWindowId(null)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    !activeWindowId
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {NAV_ITEMS.find((n) => n.id === activeNav)?.label}
                </button>
              )}

              {windows.map((w) => {
                const isTabActive = activeWindowId === w.id;
                const isEditingTab = editingTabId === w.id;
                const TabIcon =
                  w.appId === 'pdf' || w.appId === 'google-docs-export'
                    ? FileText
                    : w.appId === 'ebook'
                      ? BookOpen
                      : w.appId === 'sqlite'
                        ? Database
                        : w.appId === 'archive'
                          ? Archive
                          : w.appId === 'excalidraw' || w.appId === 'drawio' || w.appId === 'mermaid'
                            ? Workflow
                            : FileCode2;

                return (
                  <div
                    key={w.id}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      isTabActive
                        ? 'border-blue-500 bg-blue-50/80 text-blue-700 shadow-2xs dark:bg-blue-950/50 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300'
                    }`}
                  >
                    <TabIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                    {isEditingTab ? (
                      <input
                        ref={tabInputRef}
                        value={editingTabValue}
                        onChange={(e) => setEditingTabValue(e.target.value)}
                        onBlur={() => commitTabRename(w)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitTabRename(w);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingTabId(null);
                          }
                        }}
                        className="w-36 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-white"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveWindowId(w.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startTabRename(w);
                        }}
                        title={`${w.title} (Double-click to rename)`}
                        className="max-w-[160px] truncate whitespace-nowrap"
                      >
                        {w.title}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Close ${w.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeWindow(w.id);
                      }}
                      className="rounded p-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Workspace Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 lg:p-6">
          {/* Open File Directory Breadcrumb Bar (visible when a file tab is active) */}
          {activeWindow && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-[#14171F]">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {activeWindowBreadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={crumb.id}>
                    {idx > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentFolderId(crumb.id);
                        setActiveNav('explorer');
                        setActiveWindowId(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                    >
                      {idx === 0 && <FolderOpen className="h-3 w-3 text-blue-600 dark:text-blue-400" />}
                      <span className="truncate">{crumb.name}</span>
                    </button>
                  </React.Fragment>
                ))}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <button
                  type="button"
                  onDoubleClick={() => startTabRename(activeWindow)}
                  title="Double-click tab or title to rename"
                  className="truncate rounded-lg bg-slate-100 px-2 py-0.5 font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                >
                  {activeWindow.title}
                </button>
              </div>
              <span className="hidden text-[11px] text-slate-400 sm:inline">
                Double-click tab name to rename · Click any folder to jump to Drive
              </span>
            </div>
          )}

          {/* Keep open file windows mounted in background so state stays alive when switching to My Drive */}
          {windows.map((win) => (
            <div key={win.id} className={activeWindowId === win.id ? 'block' : 'hidden'}>
              {renderWorkspaceWindow(win)}
            </div>
          ))}

          {!activeWindow && (
            activeNav === 'dashboard' ? (
              <DashboardView />
            ) : activeNav === 'explorer' ? (
              <FileExplorerView mode="drive" />
            ) : activeNav === 'favorites' ? (
              <FileExplorerView mode="favorites" />
            ) : activeNav === 'recent' ? (
              <FileExplorerView mode="recent" />
            ) : activeNav === 'trash' ? (
              <FileExplorerView mode="trash" />
            ) : activeNav === 'word-sync' ? (
              <WordSyncView />
            ) : activeNav === 'apps' ? (
              renderAppsLauncher()
            ) : (
              <SettingsView />
            )
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 grid h-16 grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden dark:border-slate-800 dark:bg-[#14171F]/95">
        {(
          [
            ['dashboard', 'Home', LayoutGrid],
            ['explorer', 'Drive', FolderOpen],
            ['word-sync', 'Sync', RefreshCw],
            ['apps', 'Apps', Workflow],
          ] as const
        ).map(([id, label, Icon]) => {
          const active = !activeWindow && activeNav === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleNavClick(id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator />
    </div>
  );
};
