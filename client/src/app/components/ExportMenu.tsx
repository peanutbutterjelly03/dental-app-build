import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, FileText, FileSpreadsheet } from 'lucide-react';

export type ExportFormat = 'csv' | 'xlsx';

// One "Export" button + format dropdown, replacing the per-page "Export CSV"
// buttons (user decision 2026-07-02: format choice per tab, dropdown style).
export const ExportMenu = ({ onExport }: { onExport: (format: ExportFormat) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium"
      >
        <Download className="w-4 h-4" /> Export <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-44 bg-white rounded-lg border border-gray-200 shadow-lg py-1 z-20">
          <button role="menuitem" onClick={() => pick('csv')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-gray-50 text-left">
            <FileText className="w-4 h-4 text-muted-foreground" /> CSV (.csv)
          </button>
          <button role="menuitem" onClick={() => pick('xlsx')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-gray-50 text-left">
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground" /> Excel (.xlsx)
          </button>
        </div>
      )}
    </div>
  );
};
