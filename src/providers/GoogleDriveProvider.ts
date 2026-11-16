import { CloudFile, ListFilesQuery, StorageProvider, StorageQuota } from './StorageProvider';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,parents,thumbnailLink,iconLink,webViewLink,trashed,folderColorRgb';

function toCloudFile(raw: any): CloudFile {
  const mimeType = raw.mimeType || 'application/octet-stream';
  return {
    id: raw.id,
    name: raw.name,
    mimeType,
    size: raw.size,
    modifiedTime: raw.modifiedTime,
    createdTime: raw.createdTime,
    md5Checksum: raw.md5Checksum,
    parents: raw.parents,
    thumbnailLink: raw.thumbnailLink,
    iconLink: raw.iconLink,
    webViewLink: raw.webViewLink,
    trashed: Boolean(raw.trashed),
    folderColorRgb: raw.folderColorRgb || undefined,
    provider: 'google-drive',
    isFolder: mimeType === FOLDER_MIME,
    isGoogleWorkspaceDoc: mimeType.startsWith('application/vnd.google-apps.') && mimeType !== FOLDER_MIME,
  };
}

export class GoogleDriveProvider implements StorageProvider {
  id: 'google-drive' = 'google-drive';
  label = 'Google Drive';
  private getToken: () => string | null;
  private onUnauthorized: () => void;
  private rootFolderId: string | null = null;

  constructor(getToken: () => string | null, onUnauthorized: () => void) {
    this.getToken = getToken;
    this.onUnauthorized = onUnauthorized;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.getToken();
    if (!token) {
      this.onUnauthorized();
      throw new Error('Google Drive session expired. Please sign in with Google again.');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      this.onUnauthorized();
      throw new Error('Google Drive authorization expired. Please sign in again.');
    }
    if (!res.ok) {
      let msg = `Google Drive request failed (${res.status})`;
      try {
        const err = await res.json();
        if (err?.error?.message) msg = err.error.message;
      } catch {
        // ignore parse error
      }
      throw new Error(msg);
    }
    return res;
  }

  async getQuota(): Promise<StorageQuota> {
    const res = await this.request(`${DRIVE_API}/about?fields=storageQuota`);
    const data = await res.json();
    const q = data.storageQuota || {};
    return {
      limit: q.limit ? Number(q.limit) : undefined,
      usage: Number(q.usage || 0),
      usageInDrive: Number(q.usageInDrive || 0),
      usageInDriveTrash: Number(q.usageInDriveTrash || 0),
    };
  }

  async listFiles(query: ListFilesQuery): Promise<{ files: CloudFile[]; nextPageToken?: string }> {
    const clauses: string[] = [];

    if (query.trashedOnly) {
      clauses.push('trashed = true');
    } else {
      clauses.push('trashed = false');
      if (query.folderId && !query.search) {
        clauses.push(`'${query.folderId.replace(/'/g, "\\'")}' in parents`);
      }
    }

    if (query.search && query.search.trim()) {
      const safeSearch = query.search.trim().replace(/'/g, "\\'");
      clauses.push(`name contains '${safeSearch}'`);
    }

    if (query.mimeFilter) {
      if (query.mimeFilter === 'folders') {
        clauses.push(`mimeType = '${FOLDER_MIME}'`);
      } else if (query.mimeFilter === 'images') {
        clauses.push(`mimeType contains 'image/'`);
      } else if (query.mimeFilter === 'documents') {
        clauses.push(
          `(mimeType = 'application/vnd.google-apps.document' or mimeType contains 'wordprocessingml' or mimeType = 'text/markdown' or mimeType = 'text/plain')`
        );
      } else if (query.mimeFilter === 'pdfs') {
        clauses.push(`mimeType = 'application/pdf'`);
      } else if (query.mimeFilter === 'ebooks') {
        clauses.push(`(name contains '.epub' or mimeType = 'application/epub+zip' or mimeType = 'application/pdf')`);
      } else if (query.mimeFilter === 'archives') {
        clauses.push(`(mimeType = 'application/zip' or mimeType = 'application/x-zip-compressed' or name contains '.zip')`);
      } else if (query.mimeFilter === 'diagrams') {
        clauses.push(`(name contains '.excalidraw' or name contains '.drawio' or name contains '.mmd')`);
      } else if (query.mimeFilter === 'databases') {
        clauses.push(`(name contains '.sqlite' or name contains '.db' or mimeType contains 'sqlite')`);
      }
    }

    if (query.modifiedAfter) {
      clauses.push(`modifiedTime >= '${query.modifiedAfter}'`);
    }

    const params = new URLSearchParams({
      q: clauses.join(' and '),
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: String(query.pageSize || 100),
      orderBy: query.orderBy || 'folder,name',
    });

    if (query.pageToken) {
      params.set('pageToken', query.pageToken);
    }

    const res = await this.request(`${DRIVE_API}/files?${params.toString()}`);
    const data = await res.json();
    let files = (data.files || []).map(toCloudFile);

    if (query.extensionFilter) {
      const ext = query.extensionFilter.toLowerCase().startsWith('.')
        ? query.extensionFilter.toLowerCase()
        : `.${query.extensionFilter.toLowerCase()}`;
      files = files.filter((f: CloudFile) => f.name.toLowerCase().endsWith(ext));
    }

    if (query.minSizeBytes !== undefined) {
      files = files.filter((f: CloudFile) => f.isFolder || Number(f.size || 0) >= query.minSizeBytes!);
    }
    if (query.maxSizeBytes !== undefined) {
      files = files.filter((f: CloudFile) => f.isFolder || Number(f.size || 0) <= query.maxSizeBytes!);
    }

    return { files, nextPageToken: data.nextPageToken };
  }

  async listAllFolders(): Promise<CloudFile[]> {
    if (!this.rootFolderId) {
      try {
        const rootRes = await this.request(`${DRIVE_API}/files/root?fields=id`);
        const rootData = await rootRes.json();
        if (rootData?.id) this.rootFolderId = rootData.id;
      } catch {
        // ignore if root lookup fails
      }
    }

    const params = new URLSearchParams({
      q: `mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name,mimeType,parents,modifiedTime,folderColorRgb)',
      pageSize: '1000',
      orderBy: 'name',
    });
    const res = await this.request(`${DRIVE_API}/files?${params.toString()}`);
    const data = await res.json();
    const rawFiles = (data.files || []) as any[];

    return rawFiles
      .filter((raw) => Array.isArray(raw.parents) && raw.parents.length > 0)
      .map((raw) => {
        const normalizedParents = (raw.parents as string[]).map((p) =>
          this.rootFolderId && p === this.rootFolderId ? 'root' : p
        );
        return toCloudFile({ ...raw, parents: normalizedParents });
      });
  }

  async getFile(fileId: string): Promise<CloudFile> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`);
    return toCloudFile(await res.json());
  }

  async downloadBlob(fileId: string): Promise<Blob> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return await res.blob();
  }

  async downloadText(fileId: string): Promise<string> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return await res.text();
  }

  async exportBlob(fileId: string, mimeType: string): Promise<Blob> {
    const res = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`
    );
    return await res.blob();
  }

  async createFolder(name: string, parentId?: string): Promise<CloudFile> {
    const body: Record<string, unknown> = {
      name,
      mimeType: FOLDER_MIME,
    };
    if (parentId && parentId !== 'root') {
      body.parents = [parentId];
    }
    const res = await this.request(`${DRIVE_API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return toCloudFile(await res.json());
  }

  async uploadFile(
    file: File | Blob,
    name: string,
    mimeType: string,
    parentId?: string
  ): Promise<CloudFile> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: mimeType || 'application/octet-stream',
    };
    if (parentId && parentId !== 'root') {
      metadata.parents = [parentId];
    }

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await this.request(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        body: form,
      }
    );
    return toCloudFile(await res.json());
  }

  async updateFileContent(
    fileId: string,
    content: Blob | string,
    mimeType: string
  ): Promise<CloudFile> {
    const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
    const res = await this.request(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FILE_FIELDS}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: blob,
      }
    );
    return toCloudFile(await res.json());
  }

  async renameFile(fileId: string, newName: string): Promise<CloudFile> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    return toCloudFile(await res.json());
  }

  async updateFolderColor(fileId: string, folderColorRgb: string): Promise<CloudFile> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderColorRgb }),
    });
    return toCloudFile(await res.json());
  }

  async getFolderColorPalette(): Promise<string[]> {
    try {
      const res = await this.request(`${DRIVE_API}/about?fields=folderColorPalette`);
      const data = await res.json();
      if (Array.isArray(data?.folderColorPalette) && data.folderColorPalette.length > 0) {
        return data.folderColorPalette;
      }
    } catch {
      // fall back to static palette
    }
    return [];
  }

  async getRootFolderId(): Promise<string | null> {
    if (this.rootFolderId) return this.rootFolderId;
    try {
      const rootRes = await this.request(`${DRIVE_API}/files/root?fields=id`);
      const rootData = await rootRes.json();
      if (rootData?.id) {
        this.rootFolderId = rootData.id;
        return this.rootFolderId;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async moveFile(
    fileId: string,
    currentParents: string[],
    targetFolderId: string
  ): Promise<CloudFile> {
    const params = new URLSearchParams({
      addParents: targetFolderId,
      fields: FILE_FIELDS,
    });
    if (currentParents.length > 0) {
      params.set('removeParents', currentParents.join(','));
    }
    const res = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    return toCloudFile(await res.json());
  }

  async copyFile(fileId: string, newName: string, targetFolderId?: string): Promise<CloudFile> {
    const body: Record<string, unknown> = { name: newName };
    if (targetFolderId && targetFolderId !== 'root') {
      body.parents = [targetFolderId];
    }
    const res = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/copy?fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    return toCloudFile(await res.json());
  }

  async trashFile(fileId: string): Promise<CloudFile> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    return toCloudFile(await res.json());
  }

  async restoreFile(fileId: string): Promise<CloudFile> {
    const res = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
    return toCloudFile(await res.json());
  }

  async deletePermanently(fileId: string): Promise<void> {
    await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
  }
}
