import { decryptToken, encryptToken } from '../../lib/crypto.ts';
import { getConnectedAccount, upsertConnectedAccount } from '../../db/repositories.ts';

export const MS_SCOPES = 'offline_access User.Read Files.ReadWrite';

export function isMicrosoftConfigured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function getMicrosoftRedirectUri(): string {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${appUrl}/api/microsoft/callback`;
}

export function getMicrosoftAuthority(): string {
  const tenant = process.env.MS_TENANT_ID || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export async function exchangeMicrosoftCode(code: string) {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    code,
    redirect_uri: getMicrosoftRedirectUri(),
    grant_type: 'authorization_code',
    scope: MS_SCOPES,
  });

  const res = await fetch(`${getMicrosoftAuthority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Microsoft token exchange failed (${res.status}): ${errText}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

export async function getValidMicrosoftToken(userId: number): Promise<string> {
  if (!isMicrosoftConfigured()) {
    throw new Error('Microsoft OneDrive integration is not configured on the server.');
  }
  const acct = await getConnectedAccount(userId, 'microsoft');
  if (!acct) {
    throw new Error('Microsoft OneDrive is not connected. Connect your Microsoft account in Settings.');
  }

  const nowPlusBuffer = Date.now() + 2 * 60 * 1000;
  if (acct.expiresAt && acct.expiresAt.getTime() > nowPlusBuffer) {
    return decryptToken(acct.accessTokenEnc);
  }

  if (!acct.refreshTokenEnc) {
    return decryptToken(acct.accessTokenEnc);
  }

  const refreshToken = decryptToken(acct.refreshTokenEnc);
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: MS_SCOPES,
  });

  const res = await fetch(`${getMicrosoftAuthority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to refresh Microsoft token (${res.status}): ${errText}`);
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  await upsertConnectedAccount({
    userId,
    provider: 'microsoft',
    accountEmail: acct.accountEmail,
    accountName: acct.accountName,
    accessTokenEnc: encryptToken(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : acct.refreshTokenEnc,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope || acct.scopes,
  });

  return tokens.access_token;
}

export async function fetchMicrosoftProfile(accessToken: string) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Microsoft Graph profile error (${res.status})`);
  }
  return (await res.json()) as {
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
}

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  eTag?: string;
  lastModifiedDateTime?: string;
}

export async function uploadTempFileToOneDrive(
  msToken: string,
  tempPath: string,
  buffer: Buffer
): Promise<OneDriveItem> {
  const encodedPath = tempPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${msToken}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      body: new Uint8Array(buffer),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OneDrive temporary upload failed (${res.status}): ${errText}`);
  }
  return (await res.json()) as OneDriveItem;
}

export async function getOneDriveItem(msToken: string, itemId: string): Promise<OneDriveItem | null> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, {
    headers: { Authorization: `Bearer ${msToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OneDrive item fetch failed (${res.status}): ${errText}`);
  }
  return (await res.json()) as OneDriveItem;
}

export async function downloadOneDriveItemContent(msToken: string, itemId: string): Promise<Buffer> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/content`,
    {
      headers: { Authorization: `Bearer ${msToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OneDrive download failed (${res.status}): ${errText}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

export async function deleteOneDriveItemAndVerify(msToken: string, itemId: string): Promise<boolean> {
  const delRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${msToken}` },
    }
  );
  if (!delRes.ok && delRes.status !== 404) {
    const errText = await delRes.text();
    throw new Error(`Failed to delete temporary OneDrive file (${delRes.status}): ${errText}`);
  }

  // Mandatory confirmation: verify item no longer exists
  const check = await getOneDriveItem(msToken, itemId);
  return check === null;
}
