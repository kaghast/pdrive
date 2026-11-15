import React from 'react';
import { Toaster } from 'sonner';
import { SignInScreen } from './components/auth/SignInScreen';
import { DriveOSShell } from './components/layout/DriveOSShell';
import { DriveOSProvider, useDriveOS } from './contexts/DriveOSContext';

function RootContent() {
  const { firebaseUser, hasGoogleToken, authLoading, authError, signIn } = useDriveOS();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] text-sm text-slate-500 dark:bg-[#0B0D11] dark:text-slate-400">
        Initializing Personal Drive OS...
      </div>
    );
  }

  if (!firebaseUser || !hasGoogleToken) {
    return (
      <SignInScreen
        loading={authLoading}
        error={authError}
        needsDriveReauth={Boolean(firebaseUser && !hasGoogleToken)}
        userEmail={firebaseUser?.email}
        onSignIn={signIn}
      />
    );
  }

  return <DriveOSShell />;
}

export default function App() {
  return (
    <DriveOSProvider>
      <RootContent />
      <Toaster position="bottom-right" richColors closeButton />
    </DriveOSProvider>
  );
}
