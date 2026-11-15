import { Check, Copy, Link2, Monitor, Moon, Shield, Sun, Unlink } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDriveOS } from '../../contexts/DriveOSContext';
import { apiFetch } from '../../lib/apiClient';
import { INTEGRATED_APPS } from '../../lib/openWithRouter';
import { formatRelativeDate } from '../../lib/utils';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface AuditLogRow {
  id: number;
  action: string;
  targetType: string;
  targetName: string | null;
  status: string;
  createdAt: string;
}

const CONFIGURABLE_EXTENSIONS = ['.docx', '.md', '.pdf', '.zip', '.excalidraw', '.drawio', '.mmd', '.txt'];

export const SettingsView: React.FC = () => {
  const {
    firebaseUser,
    settings,
    updateSettings,
    microsoftStatus,
    connectMicrosoft,
    disconnectMicrosoft,
  } = useDriveOS();

  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [copiedUri, setCopiedUri] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ logs: AuditLogRow[] }>('/api/user/audit-logs')
      .then((d) => setAuditLogs(d.logs || []))
      .catch(() => {});
  }, []);

  const copyRedirectUri = () => {
    if (!microsoftStatus.redirectUri) return;
    navigator.clipboard.writeText(microsoftStatus.redirectUri);
    setCopiedUri(true);
    toast.success('Copied Azure AD callback URL');
    setTimeout(() => setCopiedUri(false), 2000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
        <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
          Settings &amp; Integrations
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Signed in as {firebaseUser?.email} · Google Drive is your authoritative storage provider.
        </p>
      </div>

      {/* Appearance & Explorer Defaults */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Appearance
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Choose light, dark, or system-matched theme.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(
              [
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
                ['system', 'System', Monitor],
              ] as const
            ).map(([val, label, Icon]) => (
              <button
                key={val}
                type="button"
                onClick={() => updateSettings({ theme: val })}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  settings.theme === val
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <h3 className="mt-6 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Default File View
          </h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['grid', 'list', 'compact'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => updateSettings({ defaultViewMode: v })}
                className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-medium capitalize transition ${
                  settings.defaultViewMode === v
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Progressive Web App
              </p>
              <p className="text-xs text-slate-500">Install on desktop or mobile home screen</p>
            </div>
            <PWAInstallButton />
          </div>
        </div>

        {/* Microsoft OneDrive Connection */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Microsoft OneDrive (Word Online Bridge)
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Used exclusively as temporary editing storage for Microsoft Word Online sessions.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
            {microsoftStatus.connected ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Connected
                  </p>
                  <p className="truncate text-xs text-slate-600 dark:text-slate-300">
                    {microsoftStatus.accountName || microsoftStatus.accountEmail || 'Microsoft Account'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-slate-900 dark:text-red-400"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {microsoftStatus.configured
                    ? 'Ready to connect your Microsoft account for Word Online editing.'
                    : 'Set MS_CLIENT_ID and MS_CLIENT_SECRET in your server environment to enable Word Online.'}
                </p>
                <button
                  type="button"
                  disabled={!microsoftStatus.configured}
                  onClick={connectMicrosoft}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Connect Microsoft OneDrive
                </button>
              </div>
            )}
          </div>

          {microsoftStatus.redirectUri && (
            <div className="mt-4">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Azure AD Redirect URI
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {microsoftStatus.redirectUri}
                </code>
                <button
                  type="button"
                  onClick={copyRedirectUri}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  {copiedUri ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Default Open With Associations */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#14171F]">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Default &ldquo;Open With&rdquo; Applications
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Configure which integrated app opens each file extension by default.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONFIGURABLE_EXTENSIONS.map((ext) => (
            <div
              key={ext}
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800"
            >
              <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                {ext}
              </span>
              <select
                value={settings.defaultOpenWith?.[ext] || 'external'}
                onChange={(e) =>
                  updateSettings({
                    defaultOpenWith: {
                      ...settings.defaultOpenWith,
                      [ext]: e.target.value,
                    },
                  })
                }
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                {Object.values(INTEGRATED_APPS)
                  .filter((a) => a.id !== 'folder')
                  .map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.label}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#14171F]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <Shield className="h-4 w-4 text-slate-500" />
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Security &amp; Synchronization Audit Log
          </h2>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {auditLogs.length === 0 ? (
            <p className="p-6 text-xs text-slate-500">No audit events recorded yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                <tr>
                  <th className="px-6 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-6 py-2.5 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-6 py-2.5 font-mono text-slate-800 dark:text-slate-200">
                      {log.action}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-slate-600 dark:text-slate-300">
                      {log.targetName || log.targetType}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`font-medium ${
                          log.status === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : log.status === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-2.5 text-right font-mono tabular-nums text-slate-500">
                      {formatRelativeDate(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        title="Disconnect Microsoft OneDrive?"
        description="Your Google Drive files remain untouched. Disconnecting prevents starting new Word Online sessions until reconnected."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          setConfirmDisconnectOpen(false);
          try {
            await disconnectMicrosoft(false);
          } catch (err: any) {
            toast.error(err.message);
          }
        }}
      />
    </div>
  );
};
