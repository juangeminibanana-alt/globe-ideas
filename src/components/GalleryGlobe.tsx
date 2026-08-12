import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Camera, Check, MapPin } from 'lucide-react';
import * as THREE from 'three';
import { GLOBE_RADIUS } from '../data';
import { getNodeHotspots, type ProductHotspot } from '../data/hotspots';
import type { WorldNode } from '../types/fastTrack';
import Globe from './Globe';
import HotspotNoteCard from './HotspotNoteCard';

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
const DEFAULT_CAMERA_Z = isMobile ? 28.8 : 20.2;

function CameraController({ targetZ }: { targetZ: React.MutableRefObject<number> }) {
  useFrame((state) => {
    state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, targetZ.current, 0.05);
  });
  return null;
}

function GlobeFocusController({
  rotationState,
  targetRotation,
}: {
  rotationState: React.MutableRefObject<{ x: number; y: number }>;
  targetRotation: React.MutableRefObject<{ x: number; y: number } | null>;
}) {
  useFrame(() => {
    const target = targetRotation.current;
    if (!target) return;

    const deltaX = target.x - rotationState.current.x;
    const deltaY = Math.atan2(
      Math.sin(target.y - rotationState.current.y),
      Math.cos(target.y - rotationState.current.y),
    );
    rotationState.current.x += deltaX * 0.12;
    rotationState.current.y += deltaY * 0.12;

    if (Math.abs(deltaX) < 0.002 && Math.abs(deltaY) < 0.002) {
      rotationState.current = { ...target };
      targetRotation.current = null;
    }
  });
  return null;
}

interface GalleryGlobeProps {
  nodes: WorldNode[];
  onSelect: (node: WorldNode) => void;
  compact?: boolean;
  hotspotsEnabled?: boolean;
}

export default function GalleryGlobe({ nodes, onSelect, compact = false, hotspotsEnabled = true }: GalleryGlobeProps) {
  const cameraZ = compact ? (isMobile ? 30.5 : 20.2) : DEFAULT_CAMERA_Z;
  const containerRef = useRef<HTMLDivElement>(null);
  const targetZ = useRef(cameraZ);
  const rotationState = useRef({ x: 0, y: 0 });
  const targetRotation = useRef<{ x: number; y: number } | null>(null);
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

  // Hotspots logic
  const hotspots = useMemo(() => getNodeHotspots(nodes), [nodes]);
  const [selectedHotspot, setSelectedHotspot] = useState<ProductHotspot | null>(null);
  const [showHotspots, setShowHotspots] = useState(true);

  const handleSelectHotspot = (hotspot: ProductHotspot) => {
    setSelectedHotspot(hotspot);
    // Rotate the selected coordinate toward the camera without snapping.
    const [hx, hy, hz] = hotspot.position;
    targetRotation.current = {
      x: THREE.MathUtils.clamp(
        Math.atan2(hy, Math.sqrt(hx * hx + hz * hz)),
        -Math.PI / 2.5,
        Math.PI / 2.5,
      ),
      y: -Math.atan2(hx, hz),
    };
    velocityState.current = { x: 0, y: 0 };
    lastInteractionTime.current = Date.now();
  };

  const handleNextHotspot = () => {
    if (!hotspots.length) return;
    if (!selectedHotspot) {
      handleSelectHotspot(hotspots[0]);
      return;
    }
    const currentIndex = hotspots.findIndex((h) => h.id === selectedHotspot.id);
    const nextIndex = (currentIndex + 1) % hotspots.length;
    handleSelectHotspot(hotspots[nextIndex]);
  };

  const handlePrevHotspot = () => {
    if (!hotspots.length) return;
    if (!selectedHotspot) {
      handleSelectHotspot(hotspots[hotspots.length - 1]);
      return;
    }
    const currentIndex = hotspots.findIndex((h) => h.id === selectedHotspot.id);
    const prevIndex = (currentIndex - 1 + hotspots.length) % hotspots.length;
    handleSelectHotspot(hotspots[prevIndex]);
  };

  useEffect(() => {
    setSelectedHotspot((current) => (
      current && hotspots.some((hotspot) => hotspot.id === current.id) ? current : null
    ));
  }, [hotspots]);

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
    targetRotation.current = null;
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

  const [snapshotSuccess, setSnapshotSuccess] = useState(false);
  const [showFlash, setShowFlash] = useState(false);

  const handleTakeSnapshot = () => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;

    // Trigger flash animation
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 250);

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `product-world-3d-globe-${timestamp}.png`;
      link.href = dataUrl;
      link.click();

      setSnapshotSuccess(true);
      setTimeout(() => setSnapshotSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to capture canvas screenshot:', err);
    }
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
      {/* Camera Flash Visual Feedback */}
      {showFlash && (
        <div className="pointer-events-none absolute inset-0 z-50 bg-white/70 backdrop-blur-sm transition-opacity duration-200" />
      )}

      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [0, 0, cameraZ], fov: 45, near: 0.1 }}
      >
        <CameraController targetZ={targetZ} />
        <GlobeFocusController rotationState={rotationState} targetRotation={targetRotation} />
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
            hotspots={hotspots}
            selectedHotspot={selectedHotspot}
            onSelectHotspot={handleSelectHotspot}
            showHotspots={hotspotsEnabled && showHotspots}
          />
        </Suspense>
      </Canvas>

      {/* Hotspots Control Toggle & Tour Trigger */}
      {hotspotsEnabled && <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <button
          onClick={() => {
            if (!hotspots.length) return;
            if (!showHotspots) {
              setShowHotspots(true);
              handleSelectHotspot(hotspots[0]);
            } else if (selectedHotspot) {
              setSelectedHotspot(null);
            } else {
              handleSelectHotspot(hotspots[0]);
            }
          }}
          className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-md shadow-xl transition-all ${
            selectedHotspot || showHotspots
              ? 'border-app-accent bg-app-accent/20 text-app-accent ring-1 ring-app-accent/50'
              : 'border-app-border bg-app-surface/90 text-app-muted hover:text-app-text'
          }`}
          title="Explorar evidencias destacadas sobre el globo"
          disabled={!hotspots.length}
        >
          <MapPin className="size-3.5 text-app-accent animate-pulse" />
          <span>Hotspots 3D ({hotspots.length})</span>
        </button>

        <button
          onClick={() => setShowHotspots(!showHotspots)}
          className="border border-app-border bg-app-surface/80 px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-app-muted hover:text-app-text"
          title={showHotspots ? 'Ocultar marcadores 3D' : 'Mostrar marcadores 3D'}
        >
          {showHotspots ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>}

      {/* Hotspot Note Card Modal Overlay */}
      {hotspotsEnabled && selectedHotspot && (
        <HotspotNoteCard
          hotspot={selectedHotspot}
          currentIndex={hotspots.findIndex((h) => h.id === selectedHotspot.id)}
          totalHotspots={hotspots.length}
          onClose={() => setSelectedHotspot(null)}
          onNext={handleNextHotspot}
          onPrev={handlePrevHotspot}
          onSelectRelatedCategory={() => {
            const node = nodes.find((item) => item.id === selectedHotspot.nodeId);
            if (node) onSelect(node);
          }}
        />
      )}

      {/* Snapshot Control Button */}
      <div className="absolute bottom-4 right-4 z-30">
        <button
          onClick={handleTakeSnapshot}
          className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-md shadow-xl transition-all ${
            snapshotSuccess
              ? 'border-emerald-500 bg-emerald-950/90 text-emerald-400'
              : 'border-app-border bg-app-surface/90 text-app-text hover:border-app-accent hover:text-app-accent hover:scale-105'
          }`}
          title="Tomar una captura de pantalla (snapshot PNG) de la vista actual del globo 3D"
        >
          {snapshotSuccess ? (
            <>
              <Check className="size-3.5 text-emerald-400" />
              <span>¡Captura PNG Guardada!</span>
            </>
          ) : (
            <>
              <Camera className="size-3.5 text-app-accent" />
              <span>Capturar PNG</span>
            </>
          )}
        </button>
      </div>

      {!compact && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap border border-app-border/70 bg-app-bg/82 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-app-muted backdrop-blur-md">
          Arrastra para explorar <span className="px-2 text-app-border">·</span> Haz clic en un Hotspot 3D o nodo
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
