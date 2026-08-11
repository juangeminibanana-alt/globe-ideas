import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, GLOBE_RADIUS } from '../data';
import type { WorldNode } from '../types/fastTrack';

interface CardProps {
  position: THREE.Vector3;
  scale?: number;
  node: WorldNode;
  onSelect: (node: WorldNode) => void;
  onHover?: (node: WorldNode) => void;
  onHoverOut?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  research: '#68e7ff',
  images: '#68e7ff',
  bible: '#ff7da9',
  video: '#ff7da9',
  data: '#80e6b0',
};

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.width / image.height;
  const areaRatio = width / height;
  const sourceWidth = imageRatio > areaRatio ? image.height * areaRatio : image.width;
  const sourceHeight = imageRatio > areaRatio ? image.height : image.width / areaRatio;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawImageContain(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawMediaGrid(context: CanvasRenderingContext2D) {
  context.fillStyle = '#0d131a';
  context.fillRect(12, 64, 336, 384);
  context.strokeStyle = '#202d38';
  context.lineWidth = 1;
  for (let x = 12; x <= 348; x += 28) {
    context.beginPath();
    context.moveTo(x, 64);
    context.lineTo(x, 448);
    context.stroke();
  }
  for (let y = 64; y <= 448; y += 28) {
    context.beginPath();
    context.moveTo(12, y);
    context.lineTo(348, y);
    context.stroke();
  }
}

function drawPlaceholder(context: CanvasRenderingContext2D, node: WorldNode) {
  const accent = CATEGORY_COLORS[node.category] ?? '#68e7ff';
  drawMediaGrid(context);
  context.fillStyle = accent;
  context.font = '600 54px "IBM Plex Mono", monospace';
  context.fillText(node.kind === 'video' ? '▶' : node.kind === 'json' ? '{}' : '◎', 145, 235);
  context.fillStyle = '#aab5c1';
  context.font = '500 13px "IBM Plex Mono", monospace';
  const words = node.summary.split(/\s+/).slice(0, 18);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > 34) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 4).forEach((text, index) => context.fillText(text, 30, 305 + index * 22));
  if (node.kind === 'video') {
    const duration = Number(node.metadata?.durationSeconds);
    const resolution = /720p/i.test(node.label) ? '720P ORIGINAL' : '1080P FINAL';
    context.fillStyle = '#f5f7fa';
    context.font = '600 12px "IBM Plex Mono", monospace';
    context.fillText(`${Number.isFinite(duration) ? `${duration} S · ` : ''}${resolution}`, 28, 408);
    context.fillStyle = accent;
    context.font = '500 10px "IBM Plex Mono", monospace';
    context.fillText(node.metadata?.canonical === true ? '● PRINCIPAL' : '▶ DISPONIBLE', 28, 432);
  }
}

export default function Card({ position, scale = 1, node, onSelect, onHover, onHoverOut }: CardProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const durationSeconds = Number(node.metadata?.durationSeconds);
  const isCanonicalVideo = node.metadata?.canonical === true;

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 460;
    const context = canvas.getContext('2d');
    const cardTexture = new THREE.CanvasTexture(canvas);
    cardTexture.colorSpace = THREE.SRGBColorSpace;
    cardTexture.minFilter = THREE.LinearFilter;
    cardTexture.generateMipmaps = false;
    const accent = CATEGORY_COLORS[node.category] ?? '#68e7ff';

    if (context) {
      context.fillStyle = '#090e14';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = node.state === 'active' ? accent : '#3a4652';
      context.lineWidth = node.state === 'active' ? 2 : 1;
      context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
      context.fillStyle = '#f5f7fa';
      context.font = '600 15px "IBM Plex Mono", monospace';
      context.fillText(node.label.toUpperCase().slice(0, 30), 14, 25);
      context.fillStyle = accent;
      context.font = '500 9px "IBM Plex Mono", monospace';
      context.fillText((node.badge ?? node.category).toUpperCase(), 14, 45);
      drawPlaceholder(context, node);
    }

    setTexture(cardTexture);
    cardTexture.needsUpdate = true;

    const image = new Image();
    if (node.thumbnailUrl && context) {
      image.onload = () => {
        const useTransparentPresentation = node.imageFit === 'contain' || Boolean(node.transparentUrl);
        if (useTransparentPresentation) {
          drawMediaGrid(context);
          drawImageContain(context, image, 24, 76, 312, 360);
        } else {
          drawImageCover(context, image, 12, 64, 336, 384);
          const fade = context.createLinearGradient(0, 318, 0, 448);
          fade.addColorStop(0, 'rgba(5, 8, 12, 0)');
          fade.addColorStop(1, 'rgba(5, 8, 12, 0.64)');
          context.fillStyle = fade;
          context.fillRect(12, 318, 336, 130);
        }
        context.strokeStyle = '#52606d';
        context.strokeRect(12, 64, 336, 384);
        cardTexture.needsUpdate = true;
      };
      image.src = node.thumbnailUrl;
    }

    return () => {
      image.onload = null;
      cardTexture.dispose();
    };
  }, [
    node.badge,
    node.category,
    node.id,
    node.imageFit,
    isCanonicalVideo,
    durationSeconds,
    node.kind,
    node.label,
    node.state,
    node.summary,
    node.thumbnailUrl,
    node.transparentUrl,
  ]);

  useEffect(() => {
    if (hovered) onHover?.(node);
  }, [hovered, node, onHover]);

  const rotationQuaternion = useMemo(() => {
    const dummy = new THREE.Object3D();
    dummy.position.copy(position);
    dummy.lookAt(position.clone().multiplyScalar(2));
    return dummy.quaternion.clone();
  }, [position]);

  const geometry = useMemo(() => {
    const width = CARD_WIDTH * scale;
    const height = CARD_HEIGHT * scale;
    const geo = new THREE.PlaneGeometry(width, height, 24, 24);
    const positions = geo.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const theta = x / GLOBE_RADIUS;
      const phi = y / GLOBE_RADIUS;
      positions.setXYZ(
        index,
        GLOBE_RADIUS * Math.sin(theta) * Math.cos(phi),
        GLOBE_RADIUS * Math.sin(phi),
        GLOBE_RADIUS * Math.cos(theta) * Math.cos(phi) - GLOBE_RADIUS,
      );
    }
    geo.computeVertexNormals();
    return geo;
  }, [scale]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      position={position}
      quaternion={rotationQuaternion}
      ref={meshRef}
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
        onHoverOut?.();
      }}
    >
      {texture && (
        <meshBasicMaterial
          map={texture}
          side={THREE.FrontSide}
          toneMapped={false}
          color={hovered ? '#fff1f6' : '#ffffff'}
        />
      )}
    </mesh>
  );
}
