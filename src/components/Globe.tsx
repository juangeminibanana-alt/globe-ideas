import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { generateFibonacciSphere } from '../utils/math';
import { DISPLAY_CARD_COUNT, GLOBE_RADIUS } from '../data';
import type { WorldNode } from '../types/fastTrack';
import Card from './Card';

const FRONT_LAYOUTS: Record<number, Array<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [[-0.24, 0], [0.24, 0]],
  3: [[-0.27, 0.18], [0.27, 0.18], [0, -0.24]],
  4: [[-0.26, 0.23], [0.26, 0.23], [-0.26, -0.23], [0.26, -0.23]],
  5: [[-0.3, 0.23], [0, 0.23], [0.3, 0.23], [-0.18, -0.23], [0.18, -0.23]],
  6: [[-0.3, 0.23], [0, 0.23], [0.3, 0.23], [-0.3, -0.23], [0, -0.23], [0.3, -0.23]],
};

function generateCardPositions(count: number): THREE.Vector3[] {
  const frontLayout = FRONT_LAYOUTS[count];
  if (!frontLayout) return generateFibonacciSphere(count, GLOBE_RADIUS);
  const frontSurfaceRadius = GLOBE_RADIUS + 0.34;
  return frontLayout.map(([normalizedX, normalizedY]) => {
    const normalizedZ = Math.sqrt(Math.max(0, 1 - normalizedX ** 2 - normalizedY ** 2));
    return new THREE.Vector3(
      normalizedX * frontSurfaceRadius,
      normalizedY * frontSurfaceRadius,
      normalizedZ * frontSurfaceRadius,
    );
  });
}

interface GlobeProps {
  nodes: WorldNode[];
  rotationState: React.MutableRefObject<{ x: number; y: number }>;
  velocityState: React.MutableRefObject<{ x: number; y: number }>;
  isDragging: React.MutableRefObject<boolean>;
  didDrag: React.MutableRefObject<boolean>;
  lastInteraction: React.MutableRefObject<number>;
  onSelect: (node: WorldNode) => void;
  onHover?: (node: WorldNode) => void;
  onHoverOut?: () => void;
}

export default function Globe({
  nodes,
  rotationState,
  velocityState,
  isDragging,
  didDrag,
  lastInteraction,
  onSelect,
  onHover,
  onHoverOut,
}: GlobeProps) {
  const groupRef = useRef<THREE.Group>(null);

  const cardData = useMemo(() => {
    const visibleNodes = nodes.slice(0, DISPLAY_CARD_COUNT);
    const positions = generateCardPositions(Math.max(visibleNodes.length, 1));
    const scales = [0.82, 0.94, 0.88, 1.04, 0.9, 0.98];
    return visibleNodes.map((node, index) => ({
      position: positions[index],
      scale: scales[index % scales.length],
      node,
    }));
  }, [nodes]);

  useFrame(() => {
    if (!groupRef.current) return;
    rotationState.current.x += velocityState.current.x;
    rotationState.current.y += velocityState.current.y;
    rotationState.current.x = Math.max(
      -Math.PI / 2.5,
      Math.min(Math.PI / 2.5, rotationState.current.x),
    );

    if (!isDragging.current) {
      velocityState.current.x *= 0.92;
      velocityState.current.y *= 0.92;
      if (nodes.length > 6 && Date.now() - lastInteraction.current > 2_000) {
        velocityState.current.y += 0.00015;
      }
    } else {
      velocityState.current.x *= 0.3;
      velocityState.current.y *= 0.3;
    }

    groupRef.current.rotation.x = rotationState.current.x;
    groupRef.current.rotation.y = rotationState.current.y;
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS - 0.12, 64, 64]} />
        <meshBasicMaterial color="#03070b" />
      </mesh>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS - 0.05, 48, 48]} />
        <meshBasicMaterial color="#3d6472" wireframe transparent opacity={0.13} />
      </mesh>
      {cardData.map((data) => (
        <Card
          key={data.node.id}
          position={data.position}
          scale={data.scale}
          node={data.node}
          onSelect={(node) => {
            if (!isDragging.current && !didDrag.current) onSelect(node);
          }}
          onHover={onHover}
          onHoverOut={onHoverOut}
        />
      ))}
    </group>
  );
}
