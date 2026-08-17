import { useEffect, useRef } from "react";

export function ParallaxImage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      targetX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      targetY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    };

    const reset = () => {
      targetX = 0;
      targetY = 0;
    };

    const loop = () => {
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      img.style.transform =
        `perspective(900px) rotateX(${curY * -6}deg) rotateY(${curX * 6}deg) ` +
        `scale(1.06) translate3d(${curX * 8}px, ${curY * 8}px, 0)`;
      raf = requestAnimationFrame(loop);
    };

    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", reset);
    raf = requestAnimationFrame(loop);

    return () => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", reset);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <img
        ref={imgRef}
        src="/auth-banner.jpg"
        alt="Auth Visual"
        draggable={false}
        className="w-full h-full object-cover select-none will-change-transform"
      />
    </div>
  );
}
