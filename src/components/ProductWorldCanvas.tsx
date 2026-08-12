import { Decal, Html, Line, Stars, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useReducedMotion } from 'motion/react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 40, 40);
const WIRE_GEOMETRY = new THREE.SphereGeometry(1, 20, 14);
const ORBIT_RING_COUNT = 5;
const ORBIT_COLORS = ['#6cecff', '#49dcff', '#32cef4', '#27b9df', '#228fac'] as const;
const LANDSCAPE_COMPOSITION_ASPECT = 16 / 9;
const PORTRAIT_COMPOSITION_ASPECT = 9 / 16;
const ORBIT_SPEED_RADIANS_PER_SECOND = 0.00035;
const MAX_FRAME_DELTA_SECONDS = 0.05;

export interface ProductWorldCanvasItem {
  id: string;
  productId: string;
  name: string;
  imageUrl?: string | null;
  imageHasAlpha?: boolean;
}

interface ProductWorldCanvasProps {
  worlds: readonly ProductWorldCanvasItem[];
  onOpenWorld: (productId: string) => void;
}

interface OrbitSpec {
  id: number;
  center: THREE.Vector3Tuple;
  axisX: number;
  axisY: number;
  rotation: number;
  zAmplitude: number;
  speed: number;
  opacity: number;
  color: string;
}

interface OrbitalPlanet {
  world: ProductWorldCanvasItem;
  orbit: OrbitSpec;
  phase: number;
  radius: number;
  spinSpeed: number;
}

interface GalaxyLayout {
  center: THREE.Vector3Tuple;
  orbits: OrbitSpec[];
  planets: OrbitalPlanet[];
}

export default function ProductWorldCanvas({ worlds, onOpenWorld }: ProductWorldCanvasProps) {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <div className="galaxy-world-shell relative h-full min-h-0 w-full overflow-hidden" aria-label="Galaxia de mundos de producto">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 20], zoom: 72, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <GalaxyScene
          worlds={worlds}
          reducedMotion={reducedMotion}
          onOpenWorld={onOpenWorld}
        />
      </Canvas>
    </div>
  );
}

function GalaxyScene({
  worlds,
  reducedMotion,
  onOpenWorld,
}: ProductWorldCanvasProps & { reducedMotion: boolean }) {
  const viewport = useThree((state) => state.viewport);
  const safeFrame = useMemo(
    () => createGalaxySafeFrame(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const layout = useMemo(
    () => createGalaxyLayout(worlds, safeFrame.width, safeFrame.height),
    [safeFrame.height, safeFrame.width, worlds],
  );
  const motionSecondsRef = useRef(0);

  useFrame((_, delta) => {
    if (!reducedMotion) {
      motionSecondsRef.current += Math.min(delta, MAX_FRAME_DELTA_SECONDS);
    }
  });

  return (
    <>
      <GalaxyEnvironment
        center={layout.center}
        width={viewport.width}
        height={viewport.height}
        reducedMotion={reducedMotion}
      />

      {layout.orbits.map((orbit) => <OrbitPath key={orbit.id} orbit={orbit} />)}

      {layout.planets.map(({ world, orbit, phase, radius, spinSpeed }) => (
        <ProductOrb
          key={world.productId}
          world={world}
          orbit={orbit}
          radius={radius}
          phase={phase}
          spinSpeed={spinSpeed}
          motionSecondsRef={motionSecondsRef}
          reducedMotion={reducedMotion}
          onOpenWorld={onOpenWorld}
        />
      ))}
    </>
  );
}

function GalaxyEnvironment({
  center,
  width,
  height,
  reducedMotion,
}: {
  center: THREE.Vector3Tuple;
  width: number;
  height: number;
  reducedMotion: boolean;
}) {
  return (
    <>
      <ambientLight intensity={0.8} />
      <Stars
        radius={48}
        depth={32}
        count={2200}
        factor={2.1}
        saturation={0.18}
        fade
        speed={reducedMotion ? 0 : 0.08}
      />
      <GalaxyDust center={center} width={width} height={height} />
      <GalaxyCore center={center} reducedMotion={reducedMotion} />
    </>
  );
}

function GalaxyDust({
  center,
  width,
  height,
}: {
  center: THREE.Vector3Tuple;
  width: number;
  height: number;
}) {
  const geometry = useMemo(() => {
    const random = mulberry32(0x47414c58);
    const positions = new Float32Array(720 * 3);
    for (let index = 0; index < positions.length; index += 3) {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.68);
      positions[index] = center[0] + Math.cos(angle) * radius * width * 0.68;
      positions[index + 1] = center[1] + Math.sin(angle) * radius * height * 0.34;
      positions[index + 2] = -7 - random() * 9;
    }
    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return nextGeometry;
  }, [center, height, width]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color="#7d6bff"
        size={0.034}
        transparent
        opacity={0.34}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

function GalaxyCore({
  center,
  reducedMotion,
}: {
  center: THREE.Vector3Tuple;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const glowTexture = useMemo(createGlowTexture, []);
  const diskPoints = useMemo(
    () => Array.from({ length: 100 }, (_, index) => {
      const angle = index / 99 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 0.86, Math.sin(angle) * 0.22, 0);
    }),
    [],
  );

  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  useFrame((_, delta) => {
    if (!reducedMotion && groupRef.current) groupRef.current.rotation.z += delta * 0.035;
  });

  return (
    <group ref={groupRef} position={center}>
      <CoreSpiralDust />
      <sprite scale={[4.3, 4.3, 1]} position={[0, 0, -0.4]}>
        <spriteMaterial
          map={glowTexture}
          color="#20cfff"
          transparent
          opacity={0.56}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite scale={[1.45, 1.45, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#dffcff"
          transparent
          opacity={0.92}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <mesh>
        <sphereGeometry args={[0.14, 24, 24]} />
        <meshBasicMaterial color="#f3ffff" toneMapped={false} />
      </mesh>
      {[0.82, 1.3, 1.9, 2.65].map((scale, index) => (
        <Line
          key={scale}
          points={diskPoints}
          scale={scale}
          rotation={[0, 0, index * 0.035]}
          color={index === 3 ? '#baf7ff' : '#44dcff'}
          lineWidth={index === 3 ? 0.9 : 0.52}
          transparent
          opacity={0.54 - index * 0.075}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      ))}
      <pointLight color="#65eaff" intensity={18} distance={8} decay={1.8} />
    </group>
  );
}

function CoreSpiralDust() {
  const geometry = useMemo(() => {
    const random = mulberry32(0x434f5245);
    const count = 620;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const arm = index % 4;
      const radius = Math.pow(random(), 0.62) * 2.15;
      const angle = arm * Math.PI / 2 + radius * 3.35 + (random() - 0.5) * 0.46;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle) * radius * 0.27;
      positions[index * 3 + 2] = -0.26 + (random() - 0.5) * 0.12;
    }
    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return nextGeometry;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color="#66eaff"
        size={0.04}
        transparent
        opacity={0.72}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function OrbitPath({ orbit }: { orbit: OrbitSpec }) {
  const points = useMemo(
    () => Array.from({ length: 220 }, (_, index) => (
      pointOnOrbit(orbit, index / 219 * Math.PI * 2, true)
    )),
    [orbit],
  );

  return (
    <Line
      points={points}
      color={orbit.color}
      lineWidth={0.68}
      transparent
      opacity={orbit.opacity}
      dashed
      dashScale={18}
      dashSize={0.18}
      gapSize={0.1}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
    />
  );
}

interface ProductOrbProps {
  world: ProductWorldCanvasItem;
  orbit: OrbitSpec;
  radius: number;
  phase: number;
  spinSpeed: number;
  motionSecondsRef: { current: number };
  reducedMotion: boolean;
  onOpenWorld: (productId: string) => void;
}

function ProductOrb({
  world,
  orbit,
  radius,
  phase,
  spinSpeed,
  motionSecondsRef,
  reducedMotion,
  onOpenWorld,
}: ProductOrbProps) {
  const groupRef = useRef<THREE.Group>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const initialPosition = useMemo(() => pointOnOrbit(orbit, phase), [orbit, phase]);

  useEffect(() => {
    if (!hovered) return undefined;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [hovered]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const frameDelta = Math.min(delta, MAX_FRAME_DELTA_SECONDS);
    const orbitAngle = phase + motionSecondsRef.current * orbit.speed;
    const nextPosition = pointOnOrbit(orbit, orbitAngle);
    const depthScale = THREE.MathUtils.mapLinear(
      nextPosition.z,
      -orbit.zAmplitude,
      orbit.zAmplitude,
      0.72,
      1.15,
    );
    const targetScale = radius * depthScale;
    const blend = reducedMotion ? 1 : 1 - Math.exp(-7 * frameDelta);
    const nextScale = THREE.MathUtils.lerp(group.scale.x, targetScale, blend);
    group.scale.setScalar(nextScale);
    group.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
    if (!reducedMotion && wireRef.current) wireRef.current.rotation.y += frameDelta * spinSpeed;
  });

  return (
    <group
      ref={groupRef}
      position={initialPosition}
      scale={radius}
      onClick={(event) => {
        event.stopPropagation();
        onOpenWorld(world.productId);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh geometry={SPHERE_GEOMETRY} dispose={null}>
        <meshPhysicalMaterial
          color="#041119"
          emissive={active ? '#0d7085' : '#03141b'}
          emissiveIntensity={active ? 0.72 : 0.32}
          roughness={0.72}
          metalness={0.08}
          transparent
          opacity={active ? 0.24 : 0.12}
          depthWrite={false}
        />
        {world.imageUrl ? (
          <Suspense fallback={null}>
            <ProductDecal imageUrl={world.imageUrl} hasAlpha={world.imageHasAlpha === true} />
          </Suspense>
        ) : null}
      </mesh>

      <mesh ref={wireRef} geometry={WIRE_GEOMETRY} scale={1.008} dispose={null}>
        <meshBasicMaterial
          color={active ? '#69efff' : '#1a8098'}
          wireframe
          transparent
          opacity={active ? 0.72 : 0.43}
          depthWrite={false}
        />
      </mesh>

      <mesh geometry={SPHERE_GEOMETRY} scale={active ? 1.1 : 1.045} dispose={null}>
        <meshBasicMaterial
          color={active ? '#6df2ff' : '#1d7890'}
          transparent
          opacity={active ? 0.18 : 0.045}
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <Html
        center
        position={[0, -1.42, 0]}
        zIndexRange={[40, 0]}
      >
        <button
          type="button"
          data-testid={`world-${world.productId}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenWorld(world.productId);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className="galaxy-world-label inline-flex w-max min-w-[4.5rem] max-w-[clamp(6.5rem,11vw,10rem)] items-center justify-center overflow-hidden border-0 bg-transparent px-1 py-2 text-center font-display text-[11px] font-semibold uppercase leading-[1.08] tracking-[0.055em] text-app-text drop-shadow-[0_2px_8px_rgba(0,0,0,1)] md:text-[13px]"
          aria-label={`Abrir mundo ${world.name}`}
          style={{
            minHeight: 44,
          }}
        >
          {world.name}
        </button>
      </Html>
    </group>
  );
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(80, 80, 0, 80, 80, 80);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.12, 'rgba(177,246,255,0.95)');
    gradient.addColorStop(0.42, 'rgba(42,211,255,0.42)');
    gradient.addColorStop(1, 'rgba(18,86,155,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 160, 160);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ProductDecal({ imageUrl, hasAlpha }: { imageUrl: string; hasAlpha: boolean }) {
  const sourceTexture = useTexture(imageUrl);
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const texture = useMemo(
    () => hasAlpha ? sourceTexture : createIsolatedProductTexture(sourceTexture),
    [hasAlpha, sourceTexture],
  );

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, maxAnisotropy);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }, [maxAnisotropy, texture]);

  useEffect(() => () => {
    if (texture !== sourceTexture) texture.dispose();
  }, [sourceTexture, texture]);

  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect = Math.max(0.45, Math.min(2.2, (image?.width ?? 1) / (image?.height ?? 1)));
  const maxWidth = 1.62;
  const maxHeight = 1.52;
  const width = aspect >= 1 ? maxWidth : Math.max(0.82, maxHeight * aspect);
  const height = aspect >= 1 ? Math.max(0.82, maxWidth / aspect) : maxHeight;

  return (
    <Decal
      position={[0, 0, 0.78]}
      rotation={[0, 0, 0]}
      scale={[width, height, 0.92]}
    >
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.035}
        depthWrite
        polygonOffset
        polygonOffsetFactor={-8}
        toneMapped={false}
      />
    </Decal>
  );
}

function createIsolatedProductTexture(source: THREE.Texture): THREE.Texture {
  const image = source.image as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const sourceWidth = image.naturalWidth ?? image.width ?? 1;
  const sourceHeight = image.naturalHeight ?? image.height ?? 1;
  if (typeof document === 'undefined' || sourceWidth <= 1 || sourceHeight <= 1) return source;

  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const sampleScale = Math.min(1, 384 / longestEdge);
  const width = Math.max(2, Math.round(sourceWidth * sampleScale));
  const height = Math.max(2, Math.round(sourceHeight * sampleScale));
  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const context = work.getContext('2d', { willReadFrequently: true });
  if (!context) return source;

  context.drawImage(image, 0, 0, width, height);
  let frame: ImageData;
  try {
    frame = context.getImageData(0, 0, width, height);
  } catch {
    return source;
  }

  const pixels = frame.data;
  const borderStep = Math.max(1, Math.floor(Math.min(width, height) / 96));
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  const addBorderSample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const key = (red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4);
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  };

  for (let x = 0; x < width; x += borderStep) {
    addBorderSample(x, 0);
    addBorderSample(x, height - 1);
  }
  for (let y = borderStep; y < height - 1; y += borderStep) {
    addBorderSample(0, y);
    addBorderSample(width - 1, y);
  }

  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  if (!dominant) return source;
  const background = {
    red: dominant.red / dominant.count,
    green: dominant.green / dominant.count,
    blue: dominant.blue / dominant.count,
  };
  const sampleCount = [...buckets.values()].reduce((total, bucket) => total + bucket.count, 0);
  const dominance = dominant.count / Math.max(1, sampleCount);
  const backgroundLuminance = background.red * 0.2126 + background.green * 0.7152 + background.blue * 0.0722;
  const backgroundSpread = Math.max(background.red, background.green, background.blue)
    - Math.min(background.red, background.green, background.blue);
  const distanceThreshold = dominance > 0.24 ? 82 : dominance > 0.12 ? 62 : 46;
  const removed = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  const colorDistanceSquared = (offset: number, red: number, green: number, blue: number) => {
    const redDelta = pixels[offset] - red;
    const greenDelta = pixels[offset + 1] - green;
    const blueDelta = pixels[offset + 2] - blue;
    return redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
  };
  const resemblesBackground = (pixelIndex: number, threshold = distanceThreshold) => {
    const offset = pixelIndex * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    return colorDistanceSquared(offset, background.red, background.green, background.blue) <= threshold * threshold
      || (backgroundLuminance > 205 && backgroundSpread < 42 && luminance > 220 && spread < 48)
      || (backgroundLuminance < 48 && luminance < 42 && spread < 55);
  };
  const enqueue = (pixelIndex: number) => {
    if (removed[pixelIndex] || !resemblesBackground(pixelIndex)) return;
    removed[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    queueStart += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  let removedCount = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let pixelIndex = 0; pixelIndex < removed.length; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (removed[pixelIndex] || resemblesBackground(pixelIndex, distanceThreshold * 0.52)) {
      pixels[offset + 3] = 0;
      removedCount += 1;
      continue;
    }
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const removedRatio = removedCount / removed.length;
  if (removedRatio < 0.08) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const normalizedX = (x / Math.max(1, width - 1) - 0.5) * 2;
        const normalizedY = (y / Math.max(1, height - 1) - 0.5) * 2;
        const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        const alpha = THREE.MathUtils.smoothstep(1.02 - radius, 0, 0.24);
        pixels[(y * width + x) * 4 + 3] = Math.round(255 * alpha);
      }
    }
    minX = 0;
    minY = 0;
    maxX = width - 1;
    maxY = height - 1;
  }

  context.putImageData(frame, 0, 0);
  const objectWidth = Math.max(1, maxX - minX + 1);
  const objectHeight = Math.max(1, maxY - minY + 1);
  const padding = Math.round(Math.max(objectWidth, objectHeight) * 0.08);
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, objectWidth + padding * 2);
  const cropHeight = Math.min(height - cropY, objectHeight + padding * 2);
  const outputSize = Math.max(256, Math.min(384, Math.max(cropWidth, cropHeight)));
  const output = document.createElement('canvas');
  output.width = outputSize;
  output.height = outputSize;
  const outputContext = output.getContext('2d');
  if (!outputContext) return source;
  const scale = Math.min((outputSize * 0.94) / cropWidth, (outputSize * 0.94) / cropHeight);
  const drawWidth = cropWidth * scale;
  const drawHeight = cropHeight * scale;
  outputContext.drawImage(
    work,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    (outputSize - drawWidth) / 2,
    (outputSize - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  const isolated = new THREE.CanvasTexture(output);
  isolated.colorSpace = THREE.SRGBColorSpace;
  isolated.needsUpdate = true;
  return isolated;
}

function createGalaxySafeFrame(viewportWidth: number, viewportHeight: number) {
  const portrait = viewportWidth < viewportHeight * 0.82;
  const aspect = portrait ? PORTRAIT_COMPOSITION_ASPECT : LANDSCAPE_COMPOSITION_ASPECT;
  const viewportAspect = viewportWidth / Math.max(viewportHeight, Number.EPSILON);

  if (viewportAspect > aspect) {
    return { width: viewportHeight * aspect, height: viewportHeight };
  }

  return { width: viewportWidth, height: viewportWidth / aspect };
}

function createGalaxyLayout(
  worlds: readonly ProductWorldCanvasItem[],
  viewportWidth: number,
  viewportHeight: number,
): GalaxyLayout {
  const portrait = viewportWidth < viewportHeight * 0.82;
  const center: THREE.Vector3Tuple = [
    portrait ? 0 : -viewportWidth * 0.14,
    portrait ? -viewportHeight * 0.12 : -viewportHeight * 0.015,
    -0.7,
  ];
  const orbitCenter: THREE.Vector3Tuple = [
    portrait ? 0 : -viewportWidth * 0.012,
    portrait ? 0 : -viewportHeight * 0.005,
    -0.7,
  ];
  const axisXFactors = portrait
    ? [0.16, 0.24, 0.32, 0.4, 0.48]
    : [0.12, 0.195, 0.27, 0.345, 0.415];
  const axisYFactors = portrait
    ? [0.09, 0.16, 0.23, 0.31, 0.39]
    : [0.07, 0.115, 0.165, 0.22, 0.29];
  const orbitSpeeds = Array.from(
    { length: ORBIT_RING_COUNT },
    () => ORBIT_SPEED_RADIANS_PER_SECOND,
  );
  const orbits: OrbitSpec[] = Array.from({ length: ORBIT_RING_COUNT }, (_, index) => ({
    id: index,
    center: orbitCenter,
    axisX: Math.max(0.72, viewportWidth * axisXFactors[index]),
    axisY: Math.max(0.34, viewportHeight * axisYFactors[index]),
    rotation: portrait ? 0.035 + index * 0.012 : 0.13 + index * 0.012,
    zAmplitude: 0.48 + index * 0.33,
    speed: orbitSpeeds[index],
    opacity: 0.58 - index * 0.045,
    color: ORBIT_COLORS[index],
  }));

  if (!worlds.length) return { center, orbits, planets: [] };

  const catalogSeed = hashString(worlds.map((world) => world.productId).sort().join('|'));
  const orderedWorlds = [...worlds].sort((left, right) => (
    hashString(`${catalogSeed}:${left.productId}`) - hashString(`${catalogSeed}:${right.productId}`)
    || left.id.localeCompare(right.id)
  ));
  const ringCapacities = [2, 3, 4, 4, 5];
  const groupedWorlds = Array.from({ length: ORBIT_RING_COUNT }, () => [] as ProductWorldCanvasItem[]);
  let worldCursor = 0;
  ringCapacities.forEach((capacity, orbitIndex) => {
    groupedWorlds[orbitIndex].push(...orderedWorlds.slice(worldCursor, worldCursor + capacity));
    worldCursor += capacity;
  });
  orderedWorlds.slice(worldCursor).forEach((world, index) => {
    groupedWorlds[ORBIT_RING_COUNT - 1 - index % 2].push(world);
  });
  const baseRadius = THREE.MathUtils.clamp(
    Math.min(viewportWidth / 10.4, viewportHeight / 6.6) * 0.42,
    0.3,
    0.72,
  );
  const planets: OrbitalPlanet[] = [];
  const placed: Array<{ orbit: OrbitSpec; phase: number }> = [];
  const ringOrder = [4, 3, 2, 1, 0];

  ringOrder.forEach((orbitIndex) => {
    const ringWorlds = groupedWorlds[orbitIndex];
    if (!ringWorlds.length) return;
    const orbit = orbits[orbitIndex];
    const spacing = Math.PI * 2 / ringWorlds.length;
    const jitters = ringWorlds.map((world) => {
      const random = mulberry32(hashString(`${catalogSeed}:jitter:${world.productId}`));
      return (random() - 0.5) * 0.1;
    });
    let bestPhases: number[] = [];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let candidate = 0; candidate < 48; candidate += 1) {
      const offset = candidate / 48 * Math.PI * 2 + orbitIndex * 0.173;
      const phases = ringWorlds.map((_, slot) => offset + slot * spacing + jitters[slot]);
      let globalScore = Number.POSITIVE_INFINITY;
      let currentScore = Number.POSITIVE_INFINITY;
      for (let sample = 0; sample < 12; sample += 1) {
        const timeOffset = sample / 12 * Math.PI * 2;
        const candidatePositions = phases.map((phase) => pointOnOrbit(orbit, phase + timeOffset));
        for (let first = 0; first < candidatePositions.length; first += 1) {
          for (let second = first + 1; second < candidatePositions.length; second += 1) {
            const distance = normalizedPlanetDistance(candidatePositions[first], candidatePositions[second]);
            globalScore = Math.min(globalScore, distance);
            if (sample === 0) currentScore = Math.min(currentScore, distance);
          }
          for (const existing of placed) {
            const existingPosition = pointOnOrbit(existing.orbit, existing.phase + timeOffset);
            const distance = normalizedPlanetDistance(candidatePositions[first], existingPosition);
            globalScore = Math.min(globalScore, distance);
            if (sample === 0) currentScore = Math.min(currentScore, distance);
          }
        }
      }
      const score = currentScore + globalScore * 0.42;
      if (score > bestScore) {
        bestScore = score;
        bestPhases = phases;
      }
    }

    ringWorlds.forEach((world, slot) => {
      const random = mulberry32(hashString(`${catalogSeed}:${world.productId}`));
      const phase = bestPhases[slot] ?? slot * spacing;
      const emphasis = world.name === 'Gorra ABZ'
        ? 1.12
        : world.productId === '1732992473481512755'
          ? 1.08
          : 1;
      planets.push({
        world,
        orbit,
        phase,
        radius: baseRadius * (0.88 + random() * 0.28) * emphasis,
        spinSpeed: (random() - 0.5) * 0.22,
      });
      placed.push({ orbit, phase });
    });
  });

  return { center, orbits, planets };
}

function normalizedPlanetDistance(left: THREE.Vector3, right: THREE.Vector3): number {
  const deltaX = (left.x - right.x) / 1.45;
  const deltaY = (left.y - right.y) / 0.78;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function pointOnOrbit(orbit: OrbitSpec, angle: number, path = false): THREE.Vector3 {
  const localX = Math.cos(angle) * orbit.axisX;
  const localY = Math.sin(angle) * orbit.axisY;
  const cosine = Math.cos(orbit.rotation);
  const sine = Math.sin(orbit.rotation);
  return new THREE.Vector3(
    orbit.center[0] + localX * cosine - localY * sine,
    orbit.center[1] + localX * sine + localY * cosine,
    path ? -2.2 - orbit.id * 0.08 : orbit.center[2] + Math.sin(angle) * orbit.zAmplitude,
  );
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
