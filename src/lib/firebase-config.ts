import fs from 'fs';
import path from 'path';

export interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readLocalFallbackConfig(): Partial<PublicFirebaseConfig> {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(raw) as Partial<PublicFirebaseConfig>;
    }
  } catch {
    // Ignore fallback read errors; env vars take precedence
  }
  return {};
}

export function getPublicFirebaseConfig(): PublicFirebaseConfig {
  const projectIdEnv =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    '';

  const apiKeyEnv =
    process.env.FIREBASE_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '';

  const fallback = !apiKeyEnv || !projectIdEnv ? readLocalFallbackConfig() : {};

  const projectId = projectIdEnv || fallback.projectId || '';
  const apiKey = apiKeyEnv || fallback.apiKey || '';
  const authDomain =
    process.env.FIREBASE_AUTH_DOMAIN ||
    process.env.VITE_FIREBASE_AUTH_DOMAIN ||
    fallback.authDomain ||
    (projectId ? `${projectId}.firebaseapp.com` : '');
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    fallback.storageBucket ||
    (projectId ? `${projectId}.firebasestorage.app` : '');
  const messagingSenderId =
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    fallback.messagingSenderId ||
    '';
  const appId =
    process.env.FIREBASE_APP_ID ||
    process.env.VITE_FIREBASE_APP_ID ||
    fallback.appId ||
    '';

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}
