/**
 * Crop, zoom and rotate a profile photo before uploading it: the result is a 512px square
 * (shown as a circle everywhere), saved as WebP, or JPEG where the browser can't encode WebP.
 */
import { RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';

const OUTPUT = 512;
/** Large photos are scaled down first: huge canvases fail on some browsers (Safari). */
const MAX_SOURCE = 2048;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file isn’t an image this browser can open. Try a JPEG or PNG.'));
    image.src = src;
  });
}

/** The chosen file as an image URL, scaled to at most MAX_SOURCE on its longest side. */
export async function prepareSource(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_SOURCE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Render the crop (the area is in the rotated image's coordinates, as react-easy-crop reports it). */
async function render(src: string, area: Area, rotation: number): Promise<Blob> {
  const image = await loadImage(src);
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const rotated = document.createElement('canvas');
  rotated.width = Math.round(image.width * cos + image.height * sin);
  rotated.height = Math.round(image.width * sin + image.height * cos);
  const ctx = rotated.getContext('2d')!;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  const out = document.createElement('canvas');
  out.width = OUTPUT;
  out.height = OUTPUT;
  const target = out.getContext('2d')!;
  target.imageSmoothingQuality = 'high';
  target.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, OUTPUT, OUTPUT);
  const webp = await toBlob(out, 'image/webp', 0.88);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(out, 'image/jpeg', 0.88); // Safari can't encode WebP
  if (!jpeg) throw new Error('Couldn’t prepare the photo.');
  return jpeg;
}

export function AvatarEditor({
  source,
  onChooseAnother,
  onCancel,
  onSave,
}: {
  source: string;
  onChooseAnother(): void;
  onCancel(): void;
  onSave(photo: Blob): Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<Area | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    area.current = pixels;
  }, []);

  const rotateBy = (degrees: number) => setRotation((r) => ((((r + degrees + 180) % 360) + 360) % 360) - 180);

  const save = async () => {
    if (!area.current) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await render(source, area.current, rotation));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="avatar-editor-backdrop" onClick={() => !saving && onCancel()}>
      <div className="avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatar-editor-title" onClick={(e) => e.stopPropagation()}>
        <header className="avatar-editor-head">
          <h2 id="avatar-editor-title">Edit photo</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={saving}>
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>
        <div className="avatar-editor-stage">
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={1}
            maxZoom={4}
            zoomSpeed={0.2}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="avatar-editor-controls">
          <label className="avatar-editor-control">
            <span className="sr-only">Zoom</span>
            <ZoomOut size={14} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="range"
              className="ui-range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              style={{ ['--to' as string]: `${((zoom - 1) / 3) * 100}%` }}
              onChange={(e) => setZoom(Number(e.target.value))}
              onDoubleClick={() => setZoom(1)}
              aria-label="Zoom"
              title="Double-click to reset"
            />
            <ZoomIn size={14} strokeWidth={1.75} aria-hidden="true" />
          </label>
          <label className="avatar-editor-control">
            <span className="sr-only">Rotation</span>
            <button type="button" className="icon-button" aria-label="Rotate left 90°" onClick={() => rotateBy(-90)}>
              <RotateCcw size={14} strokeWidth={1.75} />
            </button>
            <input
              type="range"
              className="ui-range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              // Fills outward from 0° in the middle, so the direction of the turn is visible.
              style={{
                ['--from' as string]: `${50 + Math.min(0, rotation / 3.6)}%`,
                ['--to' as string]: `${50 + Math.max(0, rotation / 3.6)}%`,
              }}
              onChange={(e) => setRotation(Number(e.target.value))}
              onDoubleClick={() => setRotation(0)}
              aria-label="Rotation"
              title="Double-click to reset"
            />
            <button type="button" className="icon-button" aria-label="Rotate right 90°" onClick={() => rotateBy(90)}>
              <RotateCw size={14} strokeWidth={1.75} />
            </button>
            <span className="avatar-editor-angle">{Math.round(rotation)}°</span>
          </label>
          <p className="avatar-editor-hint">Drag to position. Scroll or pinch to zoom.</p>
        </div>
        {error && (
          <p className="avatar-editor-error" role="alert">
            {error}
          </p>
        )}
        <footer className="avatar-editor-foot">
          <button type="button" className="profile-button" onClick={onChooseAnother} disabled={saving}>
            Choose another
          </button>
          <span className="avatar-editor-spacer" />
          <button type="button" className="profile-button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="profile-button is-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </footer>
      </div>
    </div>
  );
}
