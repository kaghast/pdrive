import { Archive, FileCode2, FileText, FolderKanban, ShieldCheck, Workflow } from 'lucide-react';
import React from 'react';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface SignInScreenProps {
  loading: boolean;
  error?: string | null;
  needsDriveReauth?: boolean;
  userEmail?: string | null;
  onSignIn: () => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  loading,
  error,
  needsDriveReauth,
  userEmail,
  onSignIn,
}) => {
  const capabilities = [
    {
      icon: FolderKanban,
      title: 'Unified Drive Explorer',
      desc: 'Grid, list, and compact browsing with folder tree, bulk operations, tags, and drag-and-drop.',
    },
    {
      icon: FileText,
      title: 'Word Online Sync Bridge',
      desc: 'Edit DOCX and Google Docs in Microsoft Word Online with verified synchronization and safe temp cleanup.',
    },
    {
      icon: FileCode2,
      title: 'Markdown & Code Studio',
      desc: 'Split CodeMirror 6 editor with GitHub Flavored Markdown, KaTeX math, Mermaid diagrams, and outline.',
    },
    {
      icon: Workflow,
      title: 'PDF & Diagram Suite',
      desc: 'PDF.js viewer, PDF-lib page assembly, Google Docs/Slides PDF export, Excalidraw, and Draw.io.',
    },
    {
      icon: Archive,
      title: 'Archive Manager',
      desc: 'Create hierarchical ZIP archives from Drive folders and extract safely with traversal guards.',
    },
    {
      icon: ShieldCheck,
      title: 'Authoritative Drive Storage',
      desc: 'Your files live permanently in Google Drive while preferences and sync states persist securely.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 dark:bg-[#0B0D11] dark:text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-5">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="Personal Drive OS" className="h-8 w-8 rounded-lg" />
          <span className="font-display text-lg font-semibold tracking-tight whitespace-nowrap">
            Personal Drive OS
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PWAInstallButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-16 pt-8 lg:pt-14">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
              Google Drive · Integrated Workspace · Progressive Web App
            </p>
            <h1
              className="mt-3 font-display text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
              style={{ textWrap: 'balance' }}
            >
              Your personal cloud operating environment.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
              {needsDriveReauth
                ? `Welcome back${userEmail ? `, ${userEmail}` : ''}. Authorize Google Drive access for this session to resume browsing and editing your files.`
                : 'Turn Google Drive into a desktop-grade workspace with built-in Markdown, PDF editing, visual diagrams, ZIP archiving, and safe Microsoft Word Online synchronization.'}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                disabled={loading}
                onClick={onSignIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {loading
                      ? 'Connecting...'
                      : needsDriveReauth
                        ? 'Reconnect Google Drive'
                        : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-6">
            {capabilities.map((cap) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#14171F]"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h2 className="mt-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {cap.title}
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {cap.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};
