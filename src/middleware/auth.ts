import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { getOrCreateUser } from '../db/repositories.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  dbUser?: {
    id: number;
    uid: string;
    email: string;
    displayName: string | null;
    photoUrl: string | null;
  };
  googleAccessToken?: string;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.firebaseUser = decoded;
    req.dbUser = await getOrCreateUser({
      uid: decoded.uid,
      email: decoded.email || 'unknown@user',
      displayName: decoded.name || null,
      photoUrl: decoded.picture || null,
    });

    const driveToken = req.headers['x-google-access-token'];
    if (typeof driveToken === 'string' && driveToken.trim().length > 0) {
      req.googleAccessToken = driveToken.trim();
    }

    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

export const requireGoogleToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.googleAccessToken) {
    return res.status(400).json({
      error: 'Google Drive access token is missing. Please reconnect your Google account.',
    });
  }
  next();
};
