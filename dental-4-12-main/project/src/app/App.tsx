import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { UpdateToast } from './components/UpdateToast';
import { SyncReportDialog } from './components/SyncReportDialog';
import { ConflictReviewDialog } from './components/ConflictReviewDialog';
import { ToastProvider } from './components/Toast';
import { initQueueProcessor } from './offline/queueProcessor';

export default function App() {
  useEffect(() => {
    initQueueProcessor();
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <UpdateToast />
        <SyncReportDialog />
        <ConflictReviewDialog />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
