import { getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { getPublicFirebaseConfig } from './firebase-config.ts';

export function getAdminAuth(): Auth {
  if (!getApps().length) {
    const { projectId } = getPublicFirebaseConfig();
    if (!projectId) {
      throw new Error(
        'FIREBASE_PROJECT_ID environment variable is not set. Configure Firebase environment variables.'
      );
    }
    initializeApp({ projectId });
  }
  return getAuth();
}
