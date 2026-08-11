import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLOBE_RADIUS } from '../data';
import type { WorldNode } from '../types/fastTrack';
import Globe from './Globe';

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
const DEFAULT_CAMERA_Z = isMobile ? 28.8 : 20.2;

function CameraController({ targetZ }: { targetZ: React.MutableRefObject<number> }) {
  useFrame((state) => {
    state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, targetZ.current, 0.05);
  });
  return null;
}

interface GalleryGlobeProps {
  nodes: WorldNode[];
  onSelect: (node: WorldNode) => void;
  compact?: boolean;
}

export default function GalleryGlobe({ nodes, onSelect, compact = false }: GalleryGlobeProps) {
  const cameraZ = compact ? (isMobile ? 30.5 : 20.2) : DEFAULT_CAMERA_Z;
  const containerRef = useRef<HTMLDivElement>(null);
  const targetZ = useRef(cameraZ);
  const rotationState = useRef({ x: 0, y: 0 });
  const velocityState = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const dragDistance = useRef(0);
  const lastMouse = useRef({ x: 0, y: 0 });
  const lastInteractionTime = useRef(Date.now());
  const pointerPos = useRef({ x: 0, y: 0 });
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [tooltipInfo, setTooltipInfo] = useState<WorldNode | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (compact) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      lastInteractionTime.current = Date.now();
      targetZ.current += event.deltaY * 0.015;
      targetZ.current = Math.max(
        -GLOBE_RADIUS * 0.8,
        Math.min(isMobile ? 35 : 28, targetZ.current),
      );
    };
    const container = containerRef.current;
    container?.addEventListener('wheel', handleWheel, { passive: false });
    return () => container?.removeEventListener('wheel', handleWheel);
  }, [compact]);

  const handlePointerDown = (event: React.PointerEvent) => {
    isDragging.current = true;
    didDrag.current = false;
    dragDistance.current = 0;
    setIsMouseDown(true);
    lastMouse.current = { x: event.clientX, y: event.clientY };
    lastInteractionTime.current = Date.now();
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    pointerPos.current = { x: event.clientX, y: event.clientY };
    if (tooltipRef.current) {
      tooltipRef.current.style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 16}px)`;
    }
    if (!isDragging.current) return;
    const deltaX = event.clientX - lastMouse.current.x;
    const deltaY = event.clientY - lastMouse.current.y;
    dragDistance.current += Math.abs(deltaX) + Math.abs(deltaY);
    if (dragDistance.current > 5) didDrag.current = true;
    lastMouse.current = { x: event.clientX, y: event.clientY };
    velocityState.current.y += deltaX * 0.005;
    velocityState.current.x += deltaY * 0.005;
    lastInteractionTime.current = Date.now();
  };

  const handlePointerUp = () => {
    isDragging.current = false;
    setIsMouseDown(false);
    lastInteractionTime.current = Date.now();
  };

  return (
    <div
      ref={containerRef}
      className={`gallery-globe-shell relative h-full w-full overflow-hidden ${isMouseDown ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <Canvas camera={{ position: [0, 0, cameraZ], fov: 45, near: 0.1 }}>
        <CameraController targetZ={targetZ} />
        <Suspense fallback={null}>
          <Globe
            nodes={nodes}
            rotationState={rotationState}
            velocityState={velocityState}
            isDragging={isDragging}
            didDrag={didDrag}
            lastInteraction={lastInteractionTime}
            onSelect={onSelect}
            onHover={setTooltipInfo}
            onHoverOut={() => setTooltipInfo(null)}
          />
        </Suspense>
      </Canvas>

      {!compact && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap border border-app-border/70 bg-app-bg/82 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-app-muted backdrop-blur-md">
          Arrastra para explorar <span className="px-2 text-app-border">·</span> Selecciona un nodo
        </div>
      )}

      {tooltipInfo && (
        <div
          ref={tooltipRef}
          className="pointer-events-none fixed left-0 top-0 z-50 max-w-xs border border-app-accent/50 bg-app-surface/95 px-4 py-3 text-sm text-app-text shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
          style={{
            willChange: 'transform',
            transform: `translate(${pointerPos.current.x + 16}px, ${pointerPos.current.y + 16}px)`,
          }}
        >
          <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-app-accent">
            {tooltipInfo.label}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-app-muted">{tooltipInfo.summary}</span>
        </div>
      )}
    </div>
  );
}
