import { X, ExternalLink, Download, Loader2 } from 'lucide-react';

// Preview-before-download, matching RAMHIS's real DocumentViewerModal
// pattern (header / scrollable preview / footer with Open + Download).
// FLORAL's files are generated client-side (jsPDF / exceljs), not fetched
// from a URL, so the blob is built first and handed to this modal as an
// object URL -- the actual save only happens once the user clicks Download.
export type PreviewKind = 'pdf' | 'excel';

interface PreviewModalProps {
  open: boolean;
  kind: PreviewKind;
  title: string;
  url: string | null;
  onClose: () => void;
  onDownload: () => void;
}

export function PreviewModal({ open, kind, title, url, onClose, onDownload }: PreviewModalProps) {
  if (!open) return null;

  return (
    // z-[80] -- above the fixed status strip (z-[60]) and the sidebar rail
    // (z-[70], Root.tsx). This modal is a hand-rolled fixed overlay, not the
    // shared native <dialog> (Modal.tsx), which gets top-layer stacking for
    // free; at z-50 the status strip painted over its header, covering the
    // title and close button during a PDF preview.
    //
    // `paddingLeft: var(--content-left)` -- centres the panel in the space
    // actually left of the sidebar rail, not the full viewport (which read
    // as "centered on the page" but visibly off-centre in the content area
    // the rail shares it with). The backdrop itself still covers the whole
    // screen, rail included -- only the centring math is offset.
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      style={{ paddingLeft: 'calc(var(--content-left, 0px) + 1rem)' }}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-card shadow-2xl ${
          kind === 'pdf' ? 'max-w-5xl' : 'max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="truncate text-base font-bold text-foreground">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-gray-100 hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
          {!url && (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Preparing preview…</span>
            </div>
          )}

          {url && kind === 'pdf' && (
            <iframe src={url} title={title} className="h-[65vh] w-full rounded-lg border-0 bg-white" />
          )}

          {url && kind === 'excel' && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center px-4">
              <p className="text-sm text-muted-foreground">
                Excel workbooks can't be previewed in the browser. Download it to open in Excel or Sheets.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-card px-5 py-4">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-gray-50"
            >
              <ExternalLink className="w-4 h-4" /> Open in new tab
            </a>
          )}
          <button
            type="button"
            onClick={onDownload}
            disabled={!url}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-60"
          >
            <Download className="w-4 h-4" /> Download
          </button>
        </div>
      </div>
    </div>
  );
}
