import { useEffect, useRef, useState } from 'react';
import { Camera, X, RotateCcw } from 'lucide-react';
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
interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export const CameraCapture = ({ onCapture, onClose }: CameraCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      // width > height requested explicitly -- a phone's default portrait
      // orientation otherwise gives a portrait stream regardless of the
      // aspect-[4/3] preview box, which then just letterboxes it instead of
      // actually framing landscape (user, 2026-09-29: "this should be in
      // landscape").
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Could not access the camera. Check that this browser has camera permission, or upload a file instead.'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPhoto({ url: URL.createObjectURL(blob), blob });
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

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-center justify-between p-6 border-b">
        <h2 className="text-lg font-bold text-foreground">Take a Photo</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6 space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
            {photo ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt -- fine, this is an internal review tool, not user-facing alt text
              <img src={photo.url} alt="Captured form" className="h-full w-full object-contain" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground text-center">
          Fill the frame with the whole form, held flat and well-lit, before capturing.
        </p>
        <div className="flex justify-center gap-3">
          {photo ? (
            <>
              <button
                type="button"
                onClick={retake}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-full text-sm font-medium hover:bg-canvas"
              >
                <RotateCcw className="w-4 h-4" /> Retake
              </button>
              <button
                type="button"
                onClick={useThisPhoto}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full hover:bg-primary-hover text-sm font-medium"
              >
                Use This Photo
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={capture}
              disabled={!!error}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-full hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Camera className="w-4 h-4" /> Capture
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
