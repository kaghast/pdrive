import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'consent',
  include_granted_scopes: 'true',
});

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let initPromise: Promise<Auth> | null = null;
let isSigningIn = false;
// Strictly in-memory OAuth access token storage (never localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;

async function loadFirebaseConfig(): Promise<Record<string, string>> {
  const buildTimeApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const buildTimeProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

  if (buildTimeApiKey && buildTimeProjectId) {
    return {
      apiKey: buildTimeApiKey,
      authDomain:
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${buildTimeProjectId}.firebaseapp.com`,
      projectId: buildTimeProjectId,
      storageBucket:
        import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${buildTimeProjectId}.firebasestorage.app`,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
    };
  }

  const res = await fetch('/api/config/firebase');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.apiKey || !data?.projectId) {
    throw new Error(
      data?.error ||
        'Google/Firebase API Key is not configured. Set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID in your Environment Variables.'
    );
  }
  return data;
}

export async function ensureFirebaseReady(): Promise<Auth> {
  if (cachedAuth) return cachedAuth;
  if (!initPromise) {
    initPromise = (async () => {
      const config = await loadFirebaseConfig();
      cachedApp = getApps().length ? getApps()[0] : initializeApp(config);
      cachedAuth = getAuth(cachedApp);
      return cachedAuth;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export const initAuth = (
  onAuthSuccess?: (user: User, googleToken: string | null) => void,
  onAuthFailure?: () => void,
  onConfigError?: (message: string) => void
) => {
  let cancelled = false;
  let unsubscribeAuth: (() => void) | null = null;

  ensureFirebaseReady()
    .then((auth) => {
      if (cancelled) return;
      unsubscribeAuth = onAuthStateChanged(auth, async (user: User | null) => {
        if (user) {
          if (!isSigningIn) {
            onAuthSuccess?.(user, cachedGoogleAccessToken);
          }
        } else {
          cachedGoogleAccessToken = null;
          onAuthFailure?.();
        }
      });
    })
    .catch((err) => {
      if (!cancelled) {
        onConfigError?.(err?.message || 'Failed to initialize Firebase Auth configuration.');
      }
    });

  return () => {
    cancelled = true;
    unsubscribeAuth?.();
  };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const auth = await ensureFirebaseReady();
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token from sign-in.');
    }
    cachedGoogleAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedGoogleAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleAccessToken = (): string | null => {
  return cachedGoogleAccessToken;
};

export const clearGoogleAccessToken = () => {
  cachedGoogleAccessToken = null;
};

export const getFirebaseIdToken = async (): Promise<string | null> => {
  const auth = await ensureFirebaseReady();
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
};

export const logout = async () => {
  cachedGoogleAccessToken = null;
  const auth = await ensureFirebaseReady();
  await auth.signOut();
};
