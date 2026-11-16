import * as Dialog from '@radix-ui/react-dialog';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  FOLDER_ICON_OPTIONS,
  FolderGlyph,
  GOOGLE_DRIVE_FOLDER_COLORS,
} from '../../lib/folderAppearance';
import { CloudFile, StorageProvider } from '../../providers/StorageProvider';

interface FolderAppearanceDialogProps {
  open: boolean;
  folder: CloudFile | null;
  currentIcon?: string | null;
  currentColor?: string | null;
  storageProvider: StorageProvider;
  onClose: () => void;
  onSave: (patch: { folderIcon: string | null; folderColor: string | null }) => Promise<void>;
}

export const FolderAppearanceDialog: React.FC<FolderAppearanceDialogProps> = ({
  open,
  folder,
  currentIcon,
  currentColor,
  storageProvider,
  onClose,
  onSave,
}) => {
  const [selectedIcon, setSelectedIcon] = useState<string>(currentIcon || 'folder');
  const [selectedColor, setSelectedColor] = useState<string>(
    currentColor || folder?.folderColorRgb || '#8f8f8f'
  );
  const [paletteColors, setPaletteColors] = useState(GOOGLE_DRIVE_FOLDER_COLORS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !folder) return;
    setSelectedIcon(currentIcon || 'folder');
    setSelectedColor(currentColor || folder.folderColorRgb || '#8f8f8f');

    storageProvider
      .getFolderColorPalette()
      .then((driveHexes) => {
        if (driveHexes.length === 0) return;
        const knownNames = new Map(
          GOOGLE_DRIVE_FOLDER_COLORS.map((c) => [c.hex.toLowerCase(), c.name])
        );
        setPaletteColors(
          driveHexes.map((hex) => ({
            hex,
            name: knownNames.get(hex.toLowerCase()) || hex,
          }))
        );
      })
      .catch(() => {});
  }, [currentColor, currentIcon, folder, open, storageProvider]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        folderIcon: selectedIcon === 'folder' ? null : selectedIcon,
        folderColor: selectedColor,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onSave({
        folderIcon: null,
        folderColor: '#8f8f8f',
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#14171F]">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                <FolderGlyph iconName={selectedIcon} color={selectedColor} className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <Dialog.Title className="flex items-center gap-1.5 font-display text-sm font-semibold text-slate-900 dark:text-white">
                  <Palette className="h-4 w-4 text-blue-600" />
                  <span>Customize Folder</span>
                </Dialog.Title>
                <p className="max-w-[240px] truncate text-xs text-slate-500">
                  {folder?.name}
                </p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-5 overflow-y-auto p-5">
            {/* Color Palette (Synced to Google Drive) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Folder Color
                </label>
                <span className="text-[11px] text-slate-400">
                  Syncs directly with Google Drive
                </span>
              </div>

              <div className="mt-2.5 grid grid-cols-8 gap-2">
                {paletteColors.map((c) => {
                  const active = selectedColor.toLowerCase() === c.hex.toLowerCase();
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      onClick={() => setSelectedColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`flex h-8 w-8 items-center justify-center rounded-full transition hover:scale-110 ${
                        active
                          ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-[#14171F]'
                          : 'ring-1 ring-black/10'
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Folder Icon Grid */}
            <div>
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Folder Icon
              </label>
              <div className="mt-2.5 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {FOLDER_ICON_OPTIONS.map((opt) => {
                  const IconComp = opt.component;
                  const active = selectedIcon === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.label}
                      onClick={() => setSelectedIcon(opt.id)}
                      className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-2.5 text-[10px] font-medium transition ${
                        active
                          ? 'border-blue-600 bg-blue-50/70 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <IconComp
                        className="h-4.5 w-4.5"
                        style={{ color: active ? selectedColor : undefined }}
                      />
                      <span className="truncate max-w-full px-1">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/40">
            <button
              type="button"
              disabled={saving}
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
