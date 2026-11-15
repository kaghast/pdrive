import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS, WordEditingSession } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import { formatBytes, formatRelativeDate } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const STATUS_DISPLAY: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  creating: {
    label: 'Preparing session',
    icon: Clock,
    tone: 'text-slate-600 dark:text-slate-300',
  },
  editing: {
    label: 'Editing in Word Online',
    icon: ExternalLink,
    tone: 'text-blue-600 dark:text-blue-400',
  },
  waiting_for_sync: {
    label: 'Waiting for synchronization',
    icon: Clock,
    tone: 'text-amber-600 dark:text-amber-400',
  },
  synchronizing: {
    label: 'Synchronizing to Google Drive',
    icon: RefreshCw,
    tone: 'text-blue-600 dark:text-blue-400',
  },
  sync_verified: {
    label: 'Synchronization verified',
    icon: ShieldCheck,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  temp_deleted: {
    label: 'Temporary file deleted',
    icon: CheckCircle2,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  completed: {
    label: 'Completed & verified',
    icon: CheckCircle2,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  sync_failed: {
    label: 'Synchronization failed (Temp copy preserved)',
    icon: AlertTriangle,
    tone: 'text-red-600 dark:text-red-400',
  },
  conflict_detected: {
    label: 'Conflict detected (Temp copy preserved)',
    icon: FileWarning,
    tone: 'text-amber-600 dark:text-amber-400',
  },
};

export const WordSyncView: React.FC = () => {
  const {
    microsoftStatus,
    connectMicrosoft,
    wordSessions,
    refreshWordSessions,
    finishWordOnlineSession,
  } = useDriveOS();

  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [gdocTarget, setGdocTarget] = useState<WordEditingSession | null>(null);
  const [conflictTarget, setConflictTarget] = useState<WordEditingSession | null>(null);
  const [discardTarget, setDiscardTarget] = useState<WordEditingSession | null>(null);

  const handleFinishSync = async (
    session: WordEditingSession,
    opts?: { saveMode?: 'overwrite_docx' | 'new_docx' | 'new_google_doc'; forceOverwrite?: boolean }
  ) => {
    if (session.isGoogleDoc && !opts?.saveMode) {
      setGdocTarget(session);
      return;
    }

    setBusySessionId(session.id);
    const res = await finishWordOnlineSession(session.id, opts);
    setBusySessionId(null);

    if (!res.ok) {
      if (res.conflict) {
        setConflictTarget(res.session || session);
        toast.warning('Version conflict detected. Choose how to resolve.');
      } else {
        toast.error(res.error || 'Sync failed. Temporary OneDrive copy preserved.');
      }
    }
  };

  const handleDownloadRecovery = async (session: WordEditingSession) => {
    try {
      const blob = await apiFetch<Blob>(`/api/word-sessions/${encodeURIComponent(session.id)}/recover`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RECOVERY-${session.driveFileName}${
        session.driveFileName.endsWith('.docx') ? '' : '.docx'
      }`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded recovery copy from OneDrive');
    } catch (err: any) {
      toast.error(err.message || 'Failed to download recovery copy');
    }
  };

  const handleDiscardTemp = async () => {
    if (!discardTarget) return;
    setBusySessionId(discardTarget.id);
    try {
      await apiFetch(`/api/word-sessions/${encodeURIComponent(discardTarget.id)}/cleanup`, {
        method: 'POST',
        body: JSON.stringify({ confirmDiscardUnsynced: true }),
      });
      await refreshWordSessions();
      toast.success('Temporary OneDrive file removed');
    } catch (err: any) {
      toast.error(err.message || 'Cleanup failed');
    } finally {
      setBusySessionId(null);
      setDiscardTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Microsoft Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            Microsoft Word Online &amp; Sync Hub
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Google Drive remains authoritative. OneDrive temporary copies are never deleted until Google Drive upload and metadata are verified.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => refreshWordSessions()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Sessions
          </button>

          {!microsoftStatus.connected && microsoftStatus.configured && (
            <button
              type="button"
              onClick={connectMicrosoft}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <UploadCloud className="h-4 w-4" />
              Connect Microsoft OneDrive
            </button>
          )}
        </div>
      </div>

      {!microsoftStatus.configured && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-[#14171F] dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Microsoft OneDrive bridge is optional
          </p>
          <p className="mt-1">
            No <code className="font-mono">MS_CLIENT_ID</code> is configured on the server. All{' '}
            <code className="font-mono">.docx</code> files open automatically in the Built-in DOCX Viewer
            (with Markdown Studio conversion and Google Docs support) without needing school Azure admin access.
            To enable Word Online later, create a free app using a personal{' '}
            <code className="font-mono">@outlook.com</code> account and set{' '}
            <code className="font-mono">MS_TENANT_ID=consumers</code>.
          </p>
        </div>
      )}

      {/* Sessions List */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Editing Sessions ({wordSessions.length})
          </h2>
        </div>

        {wordSessions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No Word Online editing sessions yet
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Open any .docx or Google Docs file from the File Explorer using &ldquo;Microsoft Word Online&rdquo; to start a tracked editing session.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {wordSessions.map((session) => {
              const st = STATUS_DISPLAY[session.status] || STATUS_DISPLAY.waiting_for_sync;
              const StatusIcon = st.icon;
              const isCompleted = session.status === 'completed';
              const isBusy = busySessionId === session.id;

              return (
                <div
                  key={session.id}
                  className="flex flex-col justify-between gap-4 px-6 py-4 lg:flex-row lg:items-center"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {session.driveFileName}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${st.tone}`}>
                        <StatusIcon className={`h-3.5 w-3.5 ${session.status === 'synchronizing' ? 'animate-spin' : ''}`} />
                        {st.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span>{session.isGoogleDoc ? 'Google Docs Export' : 'DOCX File'}</span>
                      <span>·</span>
                      <span>Started {formatRelativeDate(session.createdAt)}</span>
                      <span>·</span>
                      <span>Attempts: {session.syncAttempts}</span>
                      {session.lastVerifiedSize && (
                        <>
                          <span>·</span>
                          <span>Verified {formatBytes(session.lastVerifiedSize)}</span>
                        </>
                      )}
                    </div>

                    {session.lastError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {session.lastError}
                      </p>
                    )}
                  </div>

                  {!isCompleted && (
                    <div className="flex flex-wrap items-center gap-2">
                      {session.onedriveWebUrl && (
                        <a
                          href={session.onedriveWebUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Word Online
                        </a>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleFinishSync(session)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {isBusy
                          ? 'Synchronizing...'
                          : session.status === 'sync_failed'
                            ? 'Retry Sync'
                            : 'Finish Editing & Sync'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadRecovery(session)}
                        title="Download temporary OneDrive file for manual recovery"
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Recover Copy
                      </button>

                      <button
                        type="button"
                        onClick={() => setDiscardTarget(session)}
                        title="Discard unsynchronized temporary copy"
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Google Docs Save Choice Modal */}
      <ConfirmDialog
        open={Boolean(gdocTarget)}
        onOpenChange={(open) => !open && setGdocTarget(null)}
        title="Save Google Docs Word Online Edits"
        description={`"${gdocTarget?.driveFileName}" originated from a native Google Docs file. To protect your original document, choose how to save your Word Online edits back to Google Drive:`}
        confirmLabel="Save as New Google Docs"
        cancelLabel="Cancel"
        onConfirm={async () => {
          const t = gdocTarget!;
          setGdocTarget(null);
          await handleFinishSync(t, { saveMode: 'new_google_doc' });
        }}
      />
      {gdocTarget && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-[#14171F]">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Prefer saving as a standalone .docx file instead?
          </p>
          <button
            type="button"
            onClick={async () => {
              const t = gdocTarget;
              setGdocTarget(null);
              await handleFinishSync(t, { saveMode: 'new_docx' });
            }}
            className="mt-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Save as New .docx File
          </button>
        </div>
      )}

      {/* Conflict Resolution Modal */}
      <ConfirmDialog
        open={Boolean(conflictTarget)}
        onOpenChange={(open) => !open && setConflictTarget(null)}
        title="Version Conflict Detected"
        description={`"${conflictTarget?.driveFileName}" was modified in Google Drive after your Word Online session started. Overwriting will replace the newer Google Drive version. Save as a new copy first or confirm overwrite.`}
        confirmLabel="Overwrite Google Drive File"
        destructive
        onConfirm={async () => {
          const t = conflictTarget!;
          setConflictTarget(null);
          await handleFinishSync(t, { forceOverwrite: true });
        }}
      />

      {/* Discard Temp Copy Confirmation */}
      <ConfirmDialog
        open={Boolean(discardTarget)}
        onOpenChange={(open) => !open && setDiscardTarget(null)}
        title="Discard temporary OneDrive copy?"
        description={`This will permanently delete the temporary OneDrive file for "${discardTarget?.driveFileName}" WITHOUT synchronizing edits back to Google Drive.`}
        confirmLabel="Discard Temporary File"
        destructive
        onConfirm={handleDiscardTemp}
      />
    </div>
  );
};
