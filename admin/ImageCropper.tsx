import { useEffect, useRef, useState } from 'react';

const VIEW = 320;
const OUT = 512;

/**
 * Square cropper: drag to pan, slider to zoom. Exports a 512x512 WebP blob.
 */
export function ImageCropper({ file, onDone, onCancel }: { file: File; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError('Could not read this image.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Draws the image into a square of `size`, cover-fit then zoomed/panned (offsets are in view units). */
  const draw = (ctx: CanvasRenderingContext2D, size: number) => {
    if (!img) return;
    const k = size / VIEW;
    const base = Math.max(size / img.width, size / img.height) * zoom;
    const w = img.width * base;
    const h = img.height * base;
    const maxX = Math.max(0, (w - size) / 2);
    const maxY = Math.max(0, (h - size) / 2);
    const ox = Math.max(-maxX, Math.min(maxX, off.x * k));
    const oy = Math.max(-maxY, Math.min(maxY, off.y * k));
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (size - w) / 2 + ox, (size - h) / 2 + oy, w, h);
  };

  useEffect(() => {
    const c = canvas.current;
    if (c && img) draw(c.getContext('2d')!, VIEW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom, off]);

  const exportBlob = () => {
    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    draw(c.getContext('2d')!, OUT);
    c.toBlob(
      (b) => (b && b.type === 'image/webp' ? onDone(b) : setError('This browser cannot encode WebP. Try Chrome, Edge or Firefox.')),
      'image/webp',
      0.88,
    );
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal cropper" onClick={(e) => e.stopPropagation()}>
        <h3>Crop image</h3>
        <p className="muted">Drag to reposition, use the slider to zoom. The result is saved as a {OUT}×{OUT} WebP.</p>
        {error && <div className="notice">{error}</div>}
        <canvas
          ref={canvas}
          width={VIEW}
          height={VIEW}
          className="crop-canvas"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
          }}
          onPointerMove={(e) => {
            if (drag.current) setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y });
          }}
          onPointerUp={() => (drag.current = null)}
        />
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <div className="row-buttons">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!img} onClick={exportBlob}>
            Use image
          </button>
        </div>
      </div>
    </div>
  );
}
