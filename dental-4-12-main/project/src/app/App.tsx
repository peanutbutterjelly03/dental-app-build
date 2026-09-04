import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { SyncStatus } from './components/SyncStatus';
import { UpdateToast } from './components/UpdateToast';
import { ToastProvider } from './components/Toast';
import { initQueueProcessor } from './offline/queueProcessor';

export default function App() {
  useEffect(() => {
    initQueueProcessor();
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        {/* Floating icon only outside the app shell (Login, school picker).
            Inside it, Root's status strip renders the inline pill instead and
            this one suppresses itself — same component, same panel. */}
        <SyncStatus />
        <UpdateToast />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
