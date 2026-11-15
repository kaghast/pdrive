import crypto from 'crypto';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  parents?: string[];
  webViewLink?: string;
  trashed?: boolean;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export async function getDriveFileMeta(accessToken: string, fileId: string): Promise<DriveFileMeta> {
  const fields = 'id,name,mimeType,size,modifiedTime,md5Checksum,parents,webViewLink,trashed';
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive metadata error (${res.status}): ${errText}`);
  }
  return (await res.json()) as DriveFileMeta;
}

export async function downloadDriveFileBuffer(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive download error (${res.status}): ${errText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function exportGoogleWorkspaceFile(
  accessToken: string,
  fileId: string,
  exportMimeType: string
): Promise<Buffer> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Workspace export error (${res.status}): ${errText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function listDriveFolderChildren(
  accessToken: string,
  folderId: string
): Promise<DriveFileMeta[]> {
  const items: DriveFileMeta[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive list error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as { files?: DriveFileMeta[]; nextPageToken?: string };
    if (data.files) items.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<DriveFileMeta> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId && parentId !== 'root') {
    body.parents = [parentId];
  }
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,mimeType,parents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive folder create error (${res.status}): ${errText}`);
  }
  return (await res.json()) as DriveFileMeta;
}

export async function createDriveFileMultipart(
  accessToken: string,
  params: {
    name: string;
    mimeType: string;
    contentMimeType?: string;
    parentId?: string;
    buffer: Buffer;
  }
): Promise<DriveFileMeta> {
  const boundary = `driveos_${crypto.randomBytes(12).toString('hex')}`;
  const metadata: Record<string, unknown> = {
    name: params.name,
    mimeType: params.mimeType,
  };
  if (params.parentId && params.parentId !== 'root') {
    metadata.parents = [params.parentId];
  }

  const contentType = params.contentMimeType || params.mimeType;
  const headerPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const footerPart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const multipartBody = Buffer.concat([headerPart, params.buffer, footerPart]);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,md5Checksum,parents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive upload error (${res.status}): ${errText}`);
  }
  return (await res.json()) as DriveFileMeta;
}

export async function updateDriveFileMedia(
  accessToken: string,
  fileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<DriveFileMeta> {
  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size,modifiedTime,md5Checksum`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(buffer),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive update error (${res.status}): ${errText}`);
  }
  return (await res.json()) as DriveFileMeta;
}

export function computeMd5Hex(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}
