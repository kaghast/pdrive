export interface CloudFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  md5Checksum?: string;
  parents?: string[];
  thumbnailLink?: string;
  iconLink?: string;
  webViewLink?: string;
  trashed?: boolean;
  folderColorRgb?: string;
  provider: 'google-drive';
  isFolder: boolean;
  isGoogleWorkspaceDoc: boolean;
}

export interface StorageQuota {
  limit?: number;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}

export interface ListFilesQuery {
  folderId?: string;
  search?: string;
  trashedOnly?: boolean;
  orderBy?: 'name' | 'modifiedTime desc' | 'quotaBytesUsed desc' | 'folder,name';
  mimeFilter?: string;
  extensionFilter?: string;
  modifiedAfter?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  pageToken?: string;
  pageSize?: number;
}

export interface StorageProvider {
  id: 'google-drive';
  label: string;
  getQuota(): Promise<StorageQuota>;
  listFiles(query: ListFilesQuery): Promise<{ files: CloudFile[]; nextPageToken?: string }>;
  listAllFolders(): Promise<CloudFile[]>;
  getFile(fileId: string): Promise<CloudFile>;
  downloadBlob(fileId: string): Promise<Blob>;
  downloadText(fileId: string): Promise<string>;
  exportBlob(fileId: string, mimeType: string): Promise<Blob>;
  createFolder(name: string, parentId?: string): Promise<CloudFile>;
  uploadFile(file: File | Blob, name: string, mimeType: string, parentId?: string): Promise<CloudFile>;
  updateFileContent(fileId: string, content: Blob | string, mimeType: string): Promise<CloudFile>;
  renameFile(fileId: string, newName: string): Promise<CloudFile>;
  updateFolderColor(fileId: string, folderColorRgb: string): Promise<CloudFile>;
  getFolderColorPalette(): Promise<string[]>;
  getRootFolderId(): Promise<string | null>;
  moveFile(fileId: string, currentParents: string[], targetFolderId: string): Promise<CloudFile>;
  copyFile(fileId: string, newName: string, targetFolderId?: string): Promise<CloudFile>;
  trashFile(fileId: string): Promise<CloudFile>;
  restoreFile(fileId: string): Promise<CloudFile>;
  deletePermanently(fileId: string): Promise<void>;
}
