import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ProductHotspot } from '../data/hotspots';

interface HotspotMarkerProps {
  hotspot: ProductHotspot;
  isSelected: boolean;
  onSelect: (hotspot: ProductHotspot) => void;
}
export default function HotspotMarker({ hotspot, isSelected, onSelect }: HotspotMarkerProps) {
  const meshRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();

    // Pulse outer ring
    if (ringRef.current) {
      const scale = 1 + Math.sin(time * 3 + hotspot.number) * 0.2;
      ringRef.current.scale.set(scale, scale, scale);
      if (ringRef.current.material instanceof THREE.MeshBasicMaterial) {
        ringRef.current.material.opacity = isSelected ? 0.9 : 0.4 + Math.sin(time * 3) * 0.25;
      }
    }

    // Inner core gentle breathing
    if (innerRef.current) {
      const innerScale = isSelected ? 1.35 : hovered ? 1.2 : 1.0;
      innerRef.current.scale.lerp(new THREE.Vector3(innerScale, innerScale, innerScale), 0.1);
    }
  });

  return (
    <group ref={meshRef} position={hotspot.position}>
      {/* Outer Pulsing Highlight Ring */}
      <mesh ref={ringRef} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.32, 0.42, 32]} />
        <meshBasicMaterial
          color={hotspot.highlightColor}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer Glow Halo when selected */}
      {isSelected && (
        <mesh>
          <ringGeometry args={[0.44, 0.58, 32]} />
          <meshBasicMaterial
            color={hotspot.highlightColor}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Inner Core Point */}
      <mesh
        ref={innerRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(hotspot);
        }}
      >
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : hotspot.highlightColor}
          toneMapped={false}
        />
      </mesh>

      {/* HTML Overlay Badge with Number & Pointer */}
      <Html
        position={[0, 0, 0]}
        center
        distanceFactor={18}
        zIndexRange={[100, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(hotspot);
          }}
          className={`group pointer-events-auto relative flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-md transition-all shadow-lg ${
            isSelected
              ? 'scale-125 border-2 border-white bg-slate-950 text-white ring-4 ring-app-accent/40 ring-offset-1'
              : hovered
                ? 'scale-110 border border-app-accent bg-slate-900/90 text-app-accent'
                : 'border border-slate-700/80 bg-slate-950/80 text-slate-200 hover:border-app-accent'
          }`}
          style={{
            borderColor: isSelected ? '#ffffff' : hotspot.highlightColor,
            color: isSelected ? '#ffffff' : hotspot.highlightColor,
          }}
          title={`Punto de interés: ${hotspot.title}`}
        >
          <span
            className="flex size-4 items-center justify-center rounded-full font-extrabold text-[9px]"
            style={{
              backgroundColor: hotspot.highlightColor,
              color: '#03070b',
            }}
          >
            {hotspot.number}
          </span>
          <span className="hidden sm:inline-block max-w-[100px] truncate text-[9px]">
            {hotspot.tag}
          </span>
        </button>
      </Html>
    </group>
  );
}
