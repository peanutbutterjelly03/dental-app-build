// jsPDF + html2canvas-pro are dynamically imported (not top-level) so they
// land in their own chunk, loaded only when someone actually clicks
// "Download PDF" — not bundled into every page's initial load. These two
// libraries alone pushed the main bundle over Workbox's 2MB precache limit
// when imported at the top level.
//
// html2canvas-pro, not html2canvas — this app's Tailwind v4 colors are
// defined via the oklch() CSS function, which the original html2canvas
// can't parse ("Attempting to parse an unsupported color function").
// html2canvas-pro is a maintained fork with oklch/lab/lch support.

// The DOH Consolidated Report is 77 columns wide. Rather than paginate it
// (which either shrinks columns illegibly or splits rows across pages), the PDF
// is a single high-resolution image of the WHOLE report on one page sized to
// the table. Any PDF viewer can zoom into it and it stays crisp up to the
// capture resolution (SCALE). For a clean *printed* report the Excel export is
// the right tool (it bands columns across pages); this PDF is the on-screen,
// zoomable snapshot. To print it on standard paper, use the viewer's
// "Fit to page" (whole thing, small) or "Poster/Tile" (split across sheets).
export async function exportDohReportToPdf(element: HTMLElement, filename: string): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas-pro'),
  ]);

  // Browsers cap canvas dimensions (~16384px/side); overflowing it silently
  // clips the right/bottom edge — which cropped the SUMMARY columns at SCALE 3
  // on this wide table. Cap the scale so neither dimension exceeds MAX_DIM,
  // using SCALE 3 for sharpness when it fits and backing off when it doesn't.
  const fullW = element.scrollWidth;
  const fullH = element.scrollHeight;
  const MAX_DIM = 16000;
  const SCALE = Math.max(1, Math.min(3, MAX_DIM / fullW, MAX_DIM / fullH));
  const canvas = await html2canvas(element, {
    scale: SCALE,
    // width/height (not just windowWidth/windowHeight) are required to capture
    // beyond the element's on-screen, viewport-constrained size — without them
    // columns past the visible width were cropped.
    width: fullW,
    height: fullH,
    windowWidth: fullW,
    windowHeight: fullH,
    useCORS: true,
  });
  if (!(canvas.width > 0) || !(canvas.height > 0)) return;

  // JPEG has no alpha channel; paint white first so the background renders
  // white (not black) and jsPDF embeds it fast (its PNG path is very slow).
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const imgData = out.toDataURL('image/jpeg', 0.95);

  // One page sized exactly to the image (px units → 1:1, full resolution).
  const pdf = new jsPDF({
    orientation: out.width >= out.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [out.width, out.height],
  });
  pdf.addImage(imgData, 'JPEG', 0, 0, out.width, out.height);
  pdf.save(filename);
}

/**
 * Sprint 136 — a PDF with ONE PAGE PER ELEMENT.
 *
 * The IPTR is a two-page form: page 1 the personal/history record, page 2 the
 * five per-year dental charts. Capturing both into a single tall page would
 * make a document that is not the form. Each element becomes its own PDF page,
 * sized to itself, in the order given.
 *
 * Shares the capture rules of `exportDohReportToPdf` above — the canvas cap,
 * the white JPEG background, the explicit width/height so nothing past the
 * on-screen size is cropped.
 */
export async function exportPagesToPdf(elements: HTMLElement[], filename: string): Promise<void> {
  const pages = elements.filter(Boolean);
  if (pages.length === 0) return;

  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas-pro'),
  ]);

  let pdf: import('jspdf').jsPDF | null = null;

  for (const element of pages) {
    const fullW = element.scrollWidth;
    const fullH = element.scrollHeight;
    const MAX_DIM = 16000;
    const SCALE = Math.max(1, Math.min(3, MAX_DIM / fullW, MAX_DIM / fullH));
    const canvas = await html2canvas(element, {
      scale: SCALE,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
      useCORS: true,
    });
    if (!(canvas.width > 0) || !(canvas.height > 0)) continue;

    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const imgData = out.toDataURL('image/jpeg', 0.95);

    const orientation = out.width >= out.height ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'px', format: [out.width, out.height] });
    } else {
      pdf.addPage([out.width, out.height], orientation);
    }
    pdf.addImage(imgData, 'JPEG', 0, 0, out.width, out.height);
  }

  pdf?.save(filename);
}
