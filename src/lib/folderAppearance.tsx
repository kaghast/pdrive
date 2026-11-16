import {
  Archive,
  BookOpen,
  Briefcase,
  Camera,
  Code2,
  Cpu,
  Database,
  FileText,
  Film,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Layers,
  Lightbulb,
  Music,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Wallet,
} from 'lucide-react';
import React from 'react';

export interface FolderColorOption {
  hex: string;
  name: string;
}

// Official Google Drive v3 folderColorPalette hex values
export const GOOGLE_DRIVE_FOLDER_COLORS: FolderColorOption[] = [
  { hex: '#8f8f8f', name: 'Default Grey' },
  { hex: '#ac725e', name: 'Chocolate' },
  { hex: '#d06b64', name: 'Brick Red' },
  { hex: '#f83a22', name: 'Cardinal' },
  { hex: '#fa573c', name: 'Strawberry' },
  { hex: '#ff7537', name: 'Mars Orange' },
  { hex: '#ffad46', name: 'Amber' },
  { hex: '#fad165', name: 'Gold' },
  { hex: '#fbe983', name: 'Sand' },
  { hex: '#b3dc6c', name: 'Lime' },
  { hex: '#7bd148', name: 'Asparagus' },
  { hex: '#42d692', name: 'Spearmint' },
  { hex: '#16a765', name: 'Emerald' },
  { hex: '#92e1c0', name: 'Sea Foam' },
  { hex: '#9fe1e7', name: 'Pool' },
  { hex: '#9fc6e7', name: 'Denim' },
  { hex: '#4986e7', name: 'Drive Blue' },
  { hex: '#9a9cff', name: 'Periwinkle' },
  { hex: '#b99aff', name: 'Lavender' },
  { hex: '#a47ae2', name: 'Eggplant' },
  { hex: '#cd74e6', name: 'Orchid' },
  { hex: '#f691b2', name: 'Bubble Gum' },
  { hex: '#cca6ac', name: 'Rose Grey' },
  { hex: '#cabdbf', name: 'Mountain Grey' },
];

export interface FolderIconOption {
  id: string;
  label: string;
  component: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const FOLDER_ICON_OPTIONS: FolderIconOption[] = [
  { id: 'folder', label: 'Default', component: Folder },
  { id: 'briefcase', label: 'Work', component: Briefcase },
  { id: 'code', label: 'Code', component: Code2 },
  { id: 'book', label: 'Books', component: BookOpen },
  { id: 'graduation', label: 'Study', component: GraduationCap },
  { id: 'file-text', label: 'Docs', component: FileText },
  { id: 'archive', label: 'Archive', component: Archive },
  { id: 'database', label: 'Data', component: Database },
  { id: 'cpu', label: 'Tech', component: Cpu },
  { id: 'globe', label: 'Web', component: Globe },
  { id: 'camera', label: 'Photos', component: Camera },
  { id: 'film', label: 'Video', component: Film },
  { id: 'music', label: 'Audio', component: Music },
  { id: 'wallet', label: 'Finance', component: Wallet },
  { id: 'shield', label: 'Private', component: Shield },
  { id: 'star', label: 'Featured', component: Star },
  { id: 'heart', label: 'Personal', component: Heart },
  { id: 'lightbulb', label: 'Ideas', component: Lightbulb },
  { id: 'rocket', label: 'Launch', component: Rocket },
  { id: 'home', label: 'Home', component: Home },
  { id: 'layers', label: 'Projects', component: Layers },
  { id: 'sparkles', label: 'Creative', component: Sparkles },
];

export const FolderGlyph: React.FC<{
  iconName?: string | null;
  color?: string | null;
  className?: string;
}> = ({ iconName, color, className = 'h-5 w-5' }) => {
  const match = FOLDER_ICON_OPTIONS.find((opt) => opt.id === iconName);
  const IconComp = match?.component || Folder;
  const resolvedColor = color && color !== 'default' ? color : '#2563eb';
  const isDefaultFolder = !match || match.id === 'folder';

  return (
    <IconComp
      className={className}
      style={{
        color: resolvedColor,
        fill: isDefaultFolder ? `${resolvedColor}26` : undefined,
      }}
    />
  );
};
