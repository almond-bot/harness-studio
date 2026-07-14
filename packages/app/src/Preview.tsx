import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewProps {
  svg: string;
  sheetWidth: number;
  sheetHeight: number;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

export function Preview({ svg, sheetWidth, sheetHeight }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const pad = 32;
    const scale = Math.min(
      (el.clientWidth - pad) / sheetWidth,
      (el.clientHeight - pad) / sheetHeight
    );
    setView({
      scale,
      tx: (el.clientWidth - sheetWidth * scale) / 2,
      ty: (el.clientHeight - sheetHeight * scale) / 2,
    });
  }, [sheetWidth, sheetHeight]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(6, Math.max(0.05, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="preview"
      onDoubleClick={fit}
      onPointerDown={(e) => {
        dragging.current = { x: e.clientX, y: e.clientY };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - dragging.current.x;
        const dy = e.clientY - dragging.current.y;
        dragging.current = { x: e.clientX, y: e.clientY };
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      }}
      onPointerUp={() => (dragging.current = null)}
      onPointerLeave={() => (dragging.current = null)}
    >
      <div
        className="sheet"
        style={{
          width: sheetWidth,
          height: sheetHeight,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="zoom-hint">scroll to zoom · drag to pan · double-click to fit</div>
    </div>
  );
}
