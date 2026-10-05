import { useEffect, useRef, useState } from 'react';
import { Camera, X, RotateCcw, Smartphone } from 'lucide-react';
import { Modal } from './Modal';

// Camera capture for the Students OCR flow (2026-09-29, designed on the OCR
// Student Intake canvas -- "Take a Photo" alongside "Upload a File"). Kept as
// its own component/modal rather than inline in PatientList.tsx: the
// getUserMedia stream is a resource that must be torn down on every exit path
// (close, retake, capture, unmount), and isolating that lifecycle here keeps
// the already-very-large PatientList.tsx from also owning a MediaStream ref.
//
// Captures ONE still frame at a time, handed back as a File the SAME shape
// `handleOcrFile` already accepts from the upload dropzone -- no separate
// pipeline for the camera path.
//
// Redesigned 2026-10-05 (user pick "C, full-bleed with a form guide"):
//  · The live view fills the whole frame (`object-cover`), so there are no
//    black bars at the sides; the view is cropped to fit instead of shrunk.
//  · Landscape / Portrait chooses the frame's shape. A dashed guide marks the
//    area that is kept, and the saved photo is cropped to exactly that guide,
//    so the picture matches what the person lined up.
//  · "Camera app" hands off to the device's own camera app (full quality,
//    flash, focus) through a file input with `capture`; on a laptop that
//    opens the file picker, as there is no camera app to open.
interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

type Orientation = 'landscape' | 'portrait';

/** Where the guide sits inside the frame, as fractions of its width/height. */
const GUIDE: Record<Orientation, { l: number; t: number; r: number; b: number }> = {
  landscape: { l: 0.08, t: 0.12, r: 0.08, b: 0.12 },
  portrait: { l: 0.14, t: 0.06, r: 0.14, b: 0.06 },
};

const glass = 'bg-white/20 border border-white/40 text-white backdrop-blur-sm';

export const CameraCapture = ({ onCapture, onClose }: CameraCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const appInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [photo, setPhoto] = useState<{ url: string; blob: Blob; width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      // width > height requested explicitly -- a phone's default portrait
      // orientation otherwise gives a portrait stream regardless of the
      // frame shape. Portrait is a crop of this stream, not a rotated one.
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Could not access the camera. Check that this browser has camera permission, use the camera app, or upload a file instead.'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // The video is drawn with object-cover, so what is on screen is a centered,
  // scaled crop of the stream. Map the guide rectangle back to stream pixels
  // and keep only that.
  const capture = () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || !video.videoWidth) return;
    const { width: cw, height: ch } = frame.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const offsetX = (cw - vw * scale) / 2;
    const offsetY = (ch - vh * scale) / 2;
    const g = GUIDE[orientation];
    const gx = cw * g.l;
    const gy = ch * g.t;
    const gw = cw * (1 - g.l - g.r);
    const gh = ch * (1 - g.t - g.b);
    const sx = Math.max(0, (gx - offsetX) / scale);
    const sy = Math.max(0, (gy - offsetY) / scale);
    const sw = Math.min(vw - sx, gw / scale);
    const sh = Math.min(vh - sy, gh / scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPhoto({ url: URL.createObjectURL(blob), blob, width: canvas.width, height: canvas.height });
    }, 'image/jpeg', 0.92);
  };

  const retake = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  };

  const useThisPhoto = () => {
    if (!photo) return;
    onCapture(new File([photo.blob], `iptr-capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  };

  const g = GUIDE[orientation];
  const guideStyle = { left: `${g.l * 100}%`, top: `${g.t * 100}%`, right: `${g.r * 100}%`, bottom: `${g.b * 100}%` };

  return (
    <Modal onClose={onClose} maxWidth={orientation === 'portrait' && !photo ? 'max-w-sm' : 'max-w-xl'}>
      {/* The device's own camera app. Whatever it returns goes straight into the scan flow. */}
      <input
        ref={appInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onCapture(file);
        }}
      />
      {photo ? (
        <>
          <div className="relative w-full overflow-hidden bg-card" style={{ aspectRatio: `${photo.width} / ${photo.height}`, maxHeight: '70vh' }}>
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt -- fine, this is an internal review tool, not user-facing alt text */}
            <img src={photo.url} alt="Captured form" className="h-full w-full object-cover" />
            <button type="button" onClick={onClose} aria-label="Close" className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full ${glass}`}><X className="h-4 w-4" /></button>
          </div>
          <div className="flex justify-center gap-3 p-4">
            <button type="button" onClick={retake} className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-canvas">
              <RotateCcw className="h-4 w-4" /> Retake
            </button>
            <button type="button" onClick={useThisPhoto} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
              Use This Photo
            </button>
          </div>
        </>
      ) : error ? (
        <div className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-foreground">Take a Photo</h2>
            <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <p className="text-sm text-destructive">{error}</p>
          <button type="button" onClick={() => appInputRef.current?.click()} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
            <Smartphone className="h-4 w-4" /> Camera app
          </button>
        </div>
      ) : (
        <div ref={frameRef} className="relative w-full overflow-hidden bg-card" style={{ aspectRatio: orientation === 'landscape' ? '4 / 3' : '3 / 4' }}>
          <video
            // Callback ref: the <video> is unmounted while a captured photo is
            // shown, so after Retake the new element needs the live stream again.
            ref={(el) => {
              videoRef.current = el;
              if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
            }}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Guide: dashed outline, everything outside it dimmed. */}
          <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-white/95" style={{ ...guideStyle, boxShadow: '0 0 0 999px rgba(0,0,0,0.38)' }} />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/45 to-transparent p-3">
            <div className={`inline-flex overflow-hidden rounded-full ${glass}`} role="group" aria-label="Photo shape">
              {(['landscape', 'portrait'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrientation(o)}
                  aria-pressed={orientation === o}
                  className={`px-3 py-1 text-xs font-semibold capitalize ${orientation === o ? 'bg-white text-foreground' : 'text-white'}`}
                >
                  {o}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={`grid h-8 w-8 place-items-center rounded-full ${glass}`}><X className="h-4 w-4" /></button>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/55 to-transparent p-3 pb-4">
            <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${glass}`}>Line the form up with the outline</span>
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
              <button type="button" onClick={() => appInputRef.current?.click()} className={`inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${glass}`}>
                <Smartphone className="h-3.5 w-3.5" /> Camera app
              </button>
              <button type="button" onClick={capture} aria-label="Capture" className="grid h-14 w-14 place-items-center rounded-full border-4 border-white/60 bg-white text-foreground shadow ring-2 ring-black/25 hover:bg-gray-100">
                <Camera className="h-5 w-5" />
              </button>
              <span />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
