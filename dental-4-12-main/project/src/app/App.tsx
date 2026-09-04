import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
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
        <UpdateToast />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
