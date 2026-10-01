import { useCallback, useRef, useState } from 'react';
import { downloadBlob } from '../utils/exportCsv';
import type { PreviewKind } from '../components/PreviewModal';

interface PreviewState {
  open: boolean;
  kind: PreviewKind;
  title: string;
  filename: string;
  url: string | null;
}

const INITIAL: PreviewState = { open: false, kind: 'pdf', title: '', filename: '', url: null };

// Shared across every report's Download PDF / Download Excel button: build
// the file, show it in PreviewModal, only call downloadBlob once the user
// confirms. `building` covers the gap between click and the blob existing
// (html2canvas/exceljs are both async), so callers can disable their button.
export function usePreviewModal() {
  const [state, setState] = useState<PreviewState>(INITIAL);
  const [building, setBuilding] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanupUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  const openPreview = useCallback(
    async (kind: PreviewKind, title: string, filename: string, build: () => Promise<Blob | null>) => {
      setBuilding(true);
      setState({ open: true, kind, title, filename, url: null });
      try {
        const blob = await build();
        if (!blob) {
          setState(INITIAL);
          return;
        }
        cleanupUrl();
        blobRef.current = blob;
        urlRef.current = URL.createObjectURL(blob);
        setState((s) => (s.open ? { ...s, url: urlRef.current } : s));
      } finally {
        setBuilding(false);
      }
    },
    [],
  );

  const previewPdf = useCallback(
    (title: string, filename: string, build: () => Promise<Blob | null>) => openPreview('pdf', title, filename, build),
    [openPreview],
  );
  const previewExcel = useCallback(
    (title: string, filename: string, build: () => Promise<Blob | null>) => openPreview('excel', title, filename, build),
    [openPreview],
  );

  const closePreview = useCallback(() => {
    cleanupUrl();
    blobRef.current = null;
    setState(INITIAL);
  }, []);

  const confirmDownload = useCallback(() => {
    if (blobRef.current) downloadBlob(blobRef.current, state.filename);
    closePreview();
  }, [state.filename, closePreview]);

  return { preview: state, building, previewPdf, previewExcel, closePreview, confirmDownload };
}
