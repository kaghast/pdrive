import crypto from 'crypto';
import { Router } from 'express';
import {
  deleteConnectedAccount,
  getConnectedAccount,
  listEditingSessions,
  upsertConnectedAccount,
  writeAuditLog,
} from '../../db/repositories.ts';
import { encryptToken } from '../../lib/crypto.ts';
import { AuthRequest, requireAuth } from '../../middleware/auth.ts';
import {
  exchangeMicrosoftCode,
  fetchMicrosoftProfile,
  getMicrosoftAuthority,
  getMicrosoftRedirectUri,
  isMicrosoftConfigured,
  MS_SCOPES,
} from '../services/microsoftGraph.ts';

export const microsoftRouter = Router();

// In-memory state map (also paired with signed HttpOnly cookie) for short-lived OAuth popups
const pendingOAuthStates = new Map<
  string,
  { userId: number; codeVerifier: string; expiresAt: number }
>();

microsoftRouter.get('/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const acct = await getConnectedAccount(req.dbUser!.id, 'microsoft');
    res.json({
      configured: isMicrosoftConfigured(),
      connected: Boolean(acct),
      accountEmail: acct?.accountEmail || null,
      accountName: acct?.accountName || null,
      redirectUri: getMicrosoftRedirectUri(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to check Microsoft status' });
  }
});

microsoftRouter.get('/auth-url', requireAuth, (req: AuthRequest, res) => {
  if (!isMicrosoftConfigured()) {
    return res.status(400).json({
      error: 'Microsoft OAuth is not configured. Set MS_CLIENT_ID (and MS_CLIENT_SECRET for Web apps).',
      redirectUri: getMicrosoftRedirectUri(),
    });
  }

  const state = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  pendingOAuthStates.set(state, {
    userId: req.dbUser!.id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  res.cookie('ms_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: getMicrosoftRedirectUri(),
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  const url = `${getMicrosoftAuthority()}/authorize?${params.toString()}`;
  res.json({ url, redirectUri: getMicrosoftRedirectUri() });
});

const callbackHandler = async (req: any, res: any) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;padding:24px;">
        <h3>Microsoft Connection Cancelled</h3>
        <p>${String(error_description || error)}</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'MICROSOFT_OAUTH_ERROR', error: ${JSON.stringify(String(error_description || error))} }, '*');
          }
        </script>
      </body></html>
    `);
  }

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send('Missing OAuth code or state parameter.');
  }

  const pending = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  const cookieState = req.cookies?.ms_oauth_state;

  if (!pending || pending.expiresAt < Date.now() || (cookieState && cookieState !== state)) {
    return res.status(403).send('Invalid or expired OAuth state. Please try connecting again.');
  }

  try {
    const tokens = await exchangeMicrosoftCode(code, pending.codeVerifier);
    const profile = await fetchMicrosoftProfile(tokens.access_token);
    const accountEmail = profile.mail || profile.userPrincipalName || null;

    await upsertConnectedAccount({
      userId: pending.userId,
      provider: 'microsoft',
      accountEmail,
      accountName: profile.displayName || null,
      accessTokenEnc: encryptToken(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope || MS_SCOPES,
    });

    await writeAuditLog({
      userId: pending.userId,
      action: 'MICROSOFT_OAUTH_CONNECTED',
      targetType: 'account',
      targetName: accountEmail || 'Microsoft Account',
      status: 'success',
      ipAddress: req.ip,
    });

    res.clearCookie('ms_oauth_state', { httpOnly: true, secure: true, sameSite: 'none' });

    res.send(`
      <html>
        <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#0f172a;">
          <div style="text-align:center;max-width:340px;">
            <h3 style="margin:0 0 8px;">Microsoft OneDrive Connected</h3>
            <p style="margin:0;font-size:14px;color:#475569;">Temporary Word Online storage is ready. This window will close automatically.</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'MICROSOFT_OAUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    res.status(500).send(`
      <html><body style="font-family:system-ui;padding:24px;">
        <h3>Microsoft Connection Failed</h3>
        <p>${err.message}</p>
      </body></html>
    `);
  }
};

microsoftRouter.get('/callback', callbackHandler);
microsoftRouter.get('/callback/', callbackHandler);

microsoftRouter.post('/disconnect', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sessions = await listEditingSessions(req.dbUser!.id);
    const unsynced = sessions.filter((s) =>
      ['creating', 'editing', 'waiting_for_sync', 'synchronizing', 'sync_failed', 'conflict_detected'].includes(
        s.status
      )
    );
    if (unsynced.length > 0 && !req.body?.force) {
      return res.status(409).json({
        error: `You have ${unsynced.length} unsynchronized Word Online session(s). Synchronize or download recovery copies before disconnecting.`,
        unsyncedCount: unsynced.length,
      });
    }

    await deleteConnectedAccount(req.dbUser!.id, 'microsoft');
    await writeAuditLog({
      userId: req.dbUser!.id,
      action: 'MICROSOFT_OAUTH_DISCONNECTED',
      targetType: 'account',
      targetName: 'Microsoft OneDrive',
      status: 'success',
      ipAddress: req.ip,
    });
    res.json({ disconnected: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to disconnect Microsoft account' });
  }
});
