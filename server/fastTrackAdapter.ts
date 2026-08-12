import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  evaluatePhuVideoQa,
  isPrivatePhuProductionArtifact,
  listAllowedPhuProductionArtifacts,
  listAllowedPhuRejectedVideoArtifacts,
  loadPhuVideoQaPolicy,
} from './phuProductionArtifacts';

export const DEFAULT_FAST_TRACK_OUT_ROOT =
  'D:\\Proyectos\\automatizacion\\product-hold-ugc\\out';

const API_BASE = '/api/fast-track';
const MAX_ARTIFACTS = 256;
const MAX_NODES = 32;
const MAX_REVIEW_SAMPLE = 50;
const MAX_VARIANTS = 100;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{20,48}$/;

const ARTIFACT_DIRECTORIES = [
  '',
  'phu_images/gallery',
  'phu_images/variants',
  'phu_images/description',
  'phu_images/sizechart',
  'phu_images/ref_sheets',
  'phu_images/gallery_clean',
  'phu_sizechart',
  'phu_bible',
  'phu_video',
  'phu_video/phu_refs_r2v_16x9',
] as const;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  // HTML is intentionally served as inert source so the inspector never executes captured pages.
  '.html': 'text/plain; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

async function detectImageMime(
  filePath: string,
  extension: string,
  fallback: string,
): Promise<string> {
  if (!['.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(extension)) return fallback;
  const header = Buffer.alloc(16);
  let handle;
  try {
    handle = await open(filePath, 'r');
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
      return 'image/gif';
    }
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
  } catch {
    return fallback;
  } finally {
    await handle?.close();
  }
  return fallback;
}

type JsonRecord = Record<string, unknown>;
type ArtifactKind = 'image' | 'video' | 'json' | 'text' | 'table';
type RenderMode = 'image' | 'video' | 'code' | 'text' | 'table';
type RunStatus =
  | 'complete'
  | 'awaiting_input'
  | 'needs_review'
  | 'failed'
  | 'processing'
  | 'discovered';

interface RootContext {
  configuredPath: string;
  realPath: string | null;
}

interface RunContext {
  id: string;
  directoryName: string;
  absolutePath: string;
  stats: Stats;
}

interface ArtifactInternal {
  id: string;
  runId: string;
  absolutePath: string;
  relativePath: string;
  filename: string;
  extension: string;
  mimeType: string;
  kind: ArtifactKind;
  renderMode: RenderMode;
  role: string;
  label: string;
  size: number;
  updatedAt: string;
  updatedAtMs: number;
  durationSeconds: 10 | 15 | null;
  finalVideo: boolean;
  contentDigest: string | null;
}

interface PublicArtifact {
  id: string;
  kind: ArtifactKind;
  renderMode: RenderMode;
  role: string;
  label: string;
  filename: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  durationSeconds: 10 | 15 | null;
  url: string;
  displayUrl?: string;
  transparentUrl?: string;
  backgroundMode?: 'transparent' | 'preserved';
}

const TRANSPARENT_SOURCE_ROLES = new Set([
  'gallery_image',
  'variant_image',
  'description_image',
]);

interface NormalizedRunData {
  extract: JsonRecord;
  diagnostics: JsonRecord;
  brief: JsonRecord;
  watermark: JsonRecord;
  fondo: JsonRecord;
  fondoChoice: JsonRecord;
  product: ReturnType<typeof normalizeProduct>;
  metrics: ReturnType<typeof normalizeMetrics>;
  reviews: ReturnType<typeof normalizeReviews>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMilliseconds(value: number | null): string | null {
  if (value === null || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return array(value)
    .map(stringValue)
    .filter((item): item is string => item !== null);
}

function opaqueId(scope: string, value: string): string {
  return createHash('sha256')
    .update(`product-world-fast-track:v1:${scope}:${value}`)
    .digest('base64url')
    .slice(0, 28);
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function validateOpaqueId(id: string): boolean {
  return OPAQUE_ID_PATTERN.test(id);
}

async function loadRootContext(configuredPath: string): Promise<RootContext> {
  const absolute = path.resolve(configuredPath);
  try {
    const resolved = await realpath(absolute);
    const rootStats = await stat(resolved);
    return {
      configuredPath: absolute,
      realPath: rootStats.isDirectory() ? resolved : null,
    };
  } catch {
    return { configuredPath: absolute, realPath: null };
  }
}

async function listRuns(root: RootContext): Promise<RunContext[]> {
  if (!root.realPath) return [];

  const entries = await readdir(root.realPath, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          entry.name.startsWith('phu_out_'),
      )
      .map(async (entry): Promise<RunContext | null> => {
        const candidate = path.join(root.realPath as string, entry.name);
        try {
          const resolved = await realpath(candidate);
          if (!isPathInside(root.realPath as string, resolved)) return null;
          const candidateStats = await stat(resolved);
          if (!candidateStats.isDirectory()) return null;
          return {
            id: opaqueId('run', entry.name),
            directoryName: entry.name,
            absolutePath: resolved,
            stats: candidateStats,
          };
        } catch {
          return null;
        }
      }),
  );

  return runs
    .filter((run): run is RunContext => run !== null)
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
}

async function findRun(root: RootContext, runId: string): Promise<RunContext | null> {
  if (!validateOpaqueId(runId)) return null;
  const runs = await listRuns(root);
  return runs.find((run) => run.id === runId) ?? null;
}

async function readJsonFile(filePath: string): Promise<JsonRecord> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size > MAX_JSON_BYTES) return {};
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return record(value);
  } catch {
    return {};
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch {
    return false;
  }
}

function inferDurationSeconds(filename: string): 10 | 15 | null {
  const match = filename.match(/(?:^|[_-])(10|15)s(?:[_\-.]|$)/i);
  if (match?.[1] === '10') return 10;
  if (match?.[1] === '15') return 15;
  return null;
}

function isFinalVideoFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.mp4')) return false;
  if (!/^phu_product_hold_/.test(lower)) return false;
  if (!/(?:^|[_-])(10|15)s(?:[_-]|\.)/.test(lower)) return false;
  if (!/(?:^|[_-])1080p(?:[_-]|\.)/.test(lower)) return false;
  return !/(?:raw|720p|sample|partial|noaudio|source_reference)/.test(lower);
}

function artifactRole(relativePath: string, filename: string): string {
  const rel = relativePath.replaceAll('\\', '/').toLowerCase();
  const lower = filename.toLowerCase();

  if (rel.startsWith('phu_video/qa_rejected_handoff_v1/')) {
    return /(?:raw|720p)/.test(lower) ? 'source_video' : 'rejected_video';
  }
  if (isFinalVideoFilename(filename)) return 'final_video';
  if (rel.startsWith('phu_video/') && /\.(mp4|webm|mov)$/.test(lower)) {
    return /(?:raw|720p|partial|noaudio|source_reference)/.test(lower)
      ? 'source_video'
      : 'video_result';
  }
  if (rel.startsWith('phu_images/gallery/')) return 'gallery_image';
  if (
    rel.startsWith('phu_images/gallery_clean/') &&
    lower.endsWith('_transparent.png')
  ) {
    return 'product_isolated';
  }
  if (rel.startsWith('phu_images/gallery_clean/')) return 'clean_gallery_image';
  if (rel.startsWith('phu_images/variants/')) return 'variant_image';
  if (rel.startsWith('phu_images/description/')) return 'description_image';
  if (rel.startsWith('phu_images/sizechart/') || rel.startsWith('phu_sizechart/')) {
    return 'size_chart';
  }
  if (rel.startsWith('phu_images/ref_sheets/')) return 'reference_sheet';
  if (rel.startsWith('phu_bible/') && /\.(jpg|jpeg|png|webp)$/.test(lower)) {
    return 'product_bible';
  }
  if (rel.startsWith('phu_bible/')) return 'product_bible_data';
  if (rel.startsWith('phu_video/phu_refs_r2v_16x9/')) return 'video_reference';
  if (rel.startsWith('phu_production_15s/bibles/product-360/')) {
    return lower.endsWith('.png') ? 'product_360_view' : 'product_360_data';
  }
  if (rel === 'phu_production_15s/bibles/product-bible-visual.png') {
    return 'product_bible';
  }
  if (rel.startsWith('phu_production_15s/storyboard/')) {
    return lower.endsWith('.png') ? 'storyboard' : lower.includes('prompt') ? 'prompt' : 'storyboard_data';
  }
  if (rel.startsWith('phu_production_15s/handoff/')) return 'video_handoff';
  if (rel.startsWith('phu_production_15s/prompts/')) return 'prompt';
  if (rel === 'phu_production_15s/direction-sheet.png') return 'direction_sheet';
  if (rel.startsWith('phu_production_15s/bibles/')) {
    return lower.endsWith('.png') ? 'product_bible' : 'product_bible_data';
  }
  if (rel.startsWith('phu_production_15s/')) return 'production_metadata';
  if (lower === 'phu_product_extract.json') return 'product_extract';
  if (lower === 'phu_normalized.json') return 'normalized_data';
  if (lower === 'phu_raw.json') return 'raw_data';
  if (lower === 'phu_diagnostics.json') return 'diagnostics';
  if (lower === 'phu_run_brief.json') return 'run_brief';
  if (lower === 'phu_variants.csv') return 'variants_data';
  if (lower === 'phu_screenshot.png') return 'source_screenshot';
  if (lower.includes('prompt')) return 'prompt';
  if (lower.includes('report') || lower.includes('audit')) return 'report';
  if (lower.includes('meta') || lower.includes('manifest')) return 'metadata';
  if (lower.includes('fondo')) return 'background_choice';
  if (lower.includes('review')) return 'reviews_data';
  if (lower.includes('creator')) return 'creator_data';
  return 'supporting_artifact';
}

function artifactKind(extension: string): ArtifactKind {
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) return 'image';
  if (['.mp4', '.webm', '.mov'].includes(extension)) return 'video';
  if (extension === '.json') return 'json';
  if (extension === '.csv') return 'table';
  return 'text';
}

function renderModeFor(kind: ArtifactKind): RenderMode {
  if (kind === 'json') return 'code';
  return kind;
}

function humanizeFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/^phu_/, '');
  return stem
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function artifactPriority(artifact: ArtifactInternal): number {
  const priorities: Record<string, number> = {
    final_video: 0,
    gallery_image: 10,
    product_bible: 20,
    product_360_view: 21,
    storyboard: 22,
    direction_sheet: 23,
    variant_image: 30,
    product_isolated: 35,
    description_image: 40,
    size_chart: 45,
    source_screenshot: 50,
    reference_sheet: 55,
    video_result: 60,
    source_video: 65,
    rejected_video: 94,
    product_extract: 70,
    normalized_data: 71,
    run_brief: 72,
    diagnostics: 73,
    variants_data: 74,
    prompt: 75,
    metadata: 76,
    report: 77,
    raw_data: 95,
  };
  return priorities[artifact.role] ?? 85;
}

async function listArtifacts(run: RunContext): Promise<ArtifactInternal[]> {
  const artifacts: ArtifactInternal[] = [];
  const candidates: string[] = [];
  const videoQaPolicy = await loadPhuVideoQaPolicy(run.absolutePath);

  for (const relativeDirectory of ARTIFACT_DIRECTORIES) {
    const directory = path.resolve(run.absolutePath, relativeDirectory);
    if (directory !== run.absolutePath && !isPathInside(run.absolutePath, directory)) continue;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      candidates.push(path.join(directory, entry.name));
    }
  }

  candidates.push(...await listAllowedPhuProductionArtifacts(run.absolutePath));
  candidates.push(...await listAllowedPhuRejectedVideoArtifacts(run.absolutePath));

  for (const candidate of [...new Set(candidates)]) {
    const filename = path.basename(candidate);
    const extension = path.extname(filename).toLowerCase();
    const configuredMimeType = MIME_BY_EXTENSION[extension];
    if (!configuredMimeType) continue;

    try {
      const fileLinkStats = await lstat(candidate);
      if (!fileLinkStats.isFile() || fileLinkStats.isSymbolicLink()) continue;
      const resolved = await realpath(candidate);
      if (!isPathInside(run.absolutePath, resolved)) continue;
      const fileStats = await stat(resolved);
      if (!fileStats.isFile()) continue;
      const mimeType = await detectImageMime(resolved, extension, configuredMimeType);

      const relativePath = path.relative(run.absolutePath, resolved).replaceAll('\\', '/');
      if (videoQaPolicy.required && isPrivatePhuProductionArtifact(relativePath)) continue;
      let role = artifactRole(relativePath, filename);
      if (role === 'final_video') {
        const qaStatus = await evaluatePhuVideoQa(
          videoQaPolicy,
          relativePath,
          resolved,
          fileStats.size,
          fileStats.mtimeMs,
        );
        if (qaStatus === 'rejected') role = 'rejected_video';
        else if (qaStatus === 'pending') role = 'video_result';
      }
      const kind = artifactKind(extension);
      const contentDigest = TRANSPARENT_SOURCE_ROLES.has(role)
        ? createHash('sha256').update(await readFile(resolved)).digest('hex')
        : null;
      artifacts.push({
        id: opaqueId('artifact', `${run.directoryName}/${relativePath}`),
        runId: run.id,
        absolutePath: resolved,
        relativePath,
        filename,
        extension,
        mimeType,
        kind,
        renderMode: renderModeFor(kind),
        role,
        label: humanizeFilename(filename),
        size: fileStats.size,
        updatedAt: fileStats.mtime.toISOString(),
        updatedAtMs: fileStats.mtimeMs,
        durationSeconds: inferDurationSeconds(filename),
        finalVideo: role === 'final_video',
        contentDigest,
      });
    } catch {
      // A running pipeline can replace a file between readdir and stat.
    }
  }

  const unique = new Map<string, ArtifactInternal>();
  for (const artifact of artifacts) unique.set(artifact.id, artifact);
  return [...unique.values()]
    .sort(
      (left, right) =>
        artifactPriority(left) - artifactPriority(right) ||
        left.relativePath.localeCompare(right.relativePath, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
    )
    .slice(0, MAX_ARTIFACTS);
}

function compareFinalVideos(left: ArtifactInternal, right: ArtifactInternal): number {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs;
  }

  const leftLower = left.filename.toLowerCase();
  const rightLower = right.filename.toLowerCase();
  const leftMaxRefs = leftLower.includes('maxrefs');
  const rightMaxRefs = rightLower.includes('maxrefs');
  if (leftMaxRefs !== rightMaxRefs) return rightMaxRefs ? 1 : -1;

  const leftIs15Seconds = left.durationSeconds === 15;
  const rightIs15Seconds = right.durationSeconds === 15;
  if (leftIs15Seconds !== rightIs15Seconds) return rightIs15Seconds ? 1 : -1;

  const leftIsNamedFinal = leftLower.includes('final');
  const rightIsNamedFinal = rightLower.includes('final');
  if (leftIsNamedFinal !== rightIsNamedFinal) return rightIsNamedFinal ? 1 : -1;

  return left.relativePath.localeCompare(right.relativePath, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function orderedFinalVideos(artifacts: ArtifactInternal[]): ArtifactInternal[] {
  return artifacts
    .filter((artifact) => artifact.finalVideo)
    .sort(compareFinalVideos);
}

function selectFinalVideo(artifacts: ArtifactInternal[]): ArtifactInternal | null {
  return orderedFinalVideos(artifacts)[0] ?? null;
}

function imageStem(filename: string): string {
  return path.parse(filename).name.toLowerCase().replace(/_transparent$/, '');
}

function isolatedSourceRole(filename: string): string | null {
  const stem = imageStem(filename);
  if (stem.startsWith('gallery_')) return 'gallery_image';
  if (stem.startsWith('desc_')) return 'description_image';
  if (stem.startsWith('variant_')) return 'variant_image';
  return null;
}

function buildTransparentVariantMap(
  artifacts: ArtifactInternal[],
): Map<string, ArtifactInternal> {
  const sources = artifacts.filter((artifact) => TRANSPARENT_SOURCE_ROLES.has(artifact.role));
  const isolated = artifacts.filter(
    (artifact) => artifact.role === 'product_isolated' && artifact.mimeType === 'image/png',
  );
  const result = new Map<string, ArtifactInternal>();

  for (const variant of isolated) {
    const expectedRole = isolatedSourceRole(variant.filename);
    if (!expectedRole) continue;
    const stem = imageStem(variant.filename);
    const source = sources.find(
      (candidate) => candidate.role === expectedRole && imageStem(candidate.filename) === stem,
    );
    if (source) result.set(source.id, variant);
  }

  const variantByDigest = new Map<string, ArtifactInternal>();
  for (const source of sources) {
    const variant = result.get(source.id);
    if (source.contentDigest && variant) variantByDigest.set(source.contentDigest, variant);
  }
  for (const source of sources) {
    if (result.has(source.id) || !source.contentDigest) continue;
    const duplicateVariant = variantByDigest.get(source.contentDigest);
    if (duplicateVariant) result.set(source.id, duplicateVariant);
  }

  return result;
}

function artifactVersion(updatedAtMs: number, size: number): string {
  return `${Math.trunc(updatedAtMs)}-${size}`;
}

function artifactUrl(artifact: ArtifactInternal): string {
  return `${API_BASE}/artifacts/${artifact.id}?v=${artifactVersion(
    artifact.updatedAtMs,
    artifact.size,
  )}`;
}

function displayUrlFor(
  artifact: ArtifactInternal,
  transparentVariants: Map<string, ArtifactInternal>,
): string {
  const variant = transparentVariants.get(artifact.id);
  return artifactUrl(variant ?? artifact);
}

function toPublicArtifact(
  artifact: ArtifactInternal,
  transparentVariants: Map<string, ArtifactInternal>,
): PublicArtifact {
  const transparentVariant = transparentVariants.get(artifact.id);
  const isTransparentAsset = artifact.role === 'product_isolated';
  const transparentUrl = transparentVariant
    ? artifactUrl(transparentVariant)
    : isTransparentAsset
      ? artifactUrl(artifact)
      : undefined;
  return {
    id: artifact.id,
    kind: artifact.kind,
    renderMode: artifact.renderMode,
    role: artifact.role,
    label: artifact.label,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    size: artifact.size,
    updatedAt: artifact.updatedAt,
    durationSeconds: artifact.durationSeconds,
    url: artifactUrl(artifact),
    ...(transparentUrl
      ? {
          displayUrl: transparentUrl,
          transparentUrl,
          backgroundMode: 'transparent' as const,
        }
      : artifact.kind === 'image'
        ? { backgroundMode: 'preserved' as const }
        : {}),
  };
}

function normalizeSpecs(value: unknown) {
  return array(value)
    .map(record)
    .map((item) => ({
      name: stringValue(item.name) ?? 'Especificación',
      values: stringArray(item.values ?? item.value),
    }))
    .filter((item) => item.values.length > 0);
}

function normalizeVariants(value: unknown) {
  const source = array(value);
  const items = source.slice(0, MAX_VARIANTS).map((rawVariant) => {
    const variant = record(rawVariant);
    const attributes: Record<string, string | number | boolean | null> = {};
    const reserved = new Set([
      'sku_id',
      'seller_sku',
      'stock',
      'in_stock',
      'price',
      'origin_price',
      'currency',
      'image_uri',
      'package',
      'logistics_property',
      'garment',
    ]);
    for (const [key, attributeValue] of Object.entries(variant)) {
      if (reserved.has(key)) continue;
      if (attributeValue === null) {
        attributes[key] = null;
        continue;
      }
      if (
        typeof attributeValue === 'string' ||
        typeof attributeValue === 'number' ||
        typeof attributeValue === 'boolean'
      ) {
        attributes[key] = attributeValue;
      }
    }

    return {
      id: stringValue(variant.sku_id),
      sellerSku: stringValue(variant.seller_sku),
      stock: numberValue(variant.stock),
      inStock: booleanValue(variant.in_stock),
      price: stringValue(variant.price),
      originalPrice: stringValue(variant.origin_price),
      currency: stringValue(variant.currency),
      imageUrl: stringValue(variant.image_uri),
      attributes,
      package: record(variant.package),
      garment: record(variant.garment),
    };
  });

  return {
    count: source.length,
    truncated: source.length > MAX_VARIANTS,
    items,
  };
}

function normalizeProduct(extract: JsonRecord, artifacts: ArtifactInternal[]) {
  const source = record(extract.product);
  const price = record(source.price);
  const shipping = record(source.shipping);
  const seller = record(source.seller);
  const variants = normalizeVariants(source.variants);
  const hero = artifacts.find((artifact) => artifact.role === 'gallery_image') ?? null;
  const transparentVariants = buildTransparentVariantMap(artifacts);
  const heroTransparent = hero ? transparentVariants.get(hero.id) ?? null : null;

  return {
    id: stringValue(source.id),
    title: stringValue(source.title) ?? 'Producto sin título',
    description: stringArray(source.description),
    sourceUrl: stringValue(extract.source_url),
    finalUrl: stringValue(extract.final_url),
    extractedAt: stringValue(extract.extracted_at),
    heroArtifactId: hero?.id ?? null,
    heroUrl: hero ? artifactUrl(hero) : null,
    heroDisplayUrl: hero ? displayUrlFor(hero, transparentVariants) : null,
    heroTransparentUrl: heroTransparent ? artifactUrl(heroTransparent) : null,
    price: {
      current: stringValue(price.current),
      currentValue: numberValue(price.current),
      original: stringValue(price.original),
      originalValue: numberValue(price.original),
      discount: stringValue(price.discount),
      saving: stringValue(price.saving),
      currency: stringValue(price.currency),
      symbol: stringValue(price.symbol),
    },
    shipping: {
      label: stringValue(shipping.label),
      fee: stringValue(shipping.fee_real),
      feeValue: numberValue(shipping.fee_real),
      originalFee: stringValue(shipping.fee_original),
      currency: stringValue(shipping.currency),
    },
    seller: {
      id: stringValue(seller.id),
      name: stringValue(seller.name),
      followersCount: numberValue(seller.followers_count),
      soldCount: numberValue(seller.shop_sold_count ?? seller.global_sold_count),
      reviewCount: numberValue(seller.shop_review_count),
      productCount: numberValue(seller.on_sell_product_count),
      shopUrl: stringValue(seller.shop_link),
      logoUrl: stringValue(seller.logo),
    },
    specs: normalizeSpecs(source.specs),
    categories: array(source.categories)
      .map(record)
      .map((category) => ({
        id: stringValue(category.category_id),
        name: stringValue(category.category_name ?? category.name),
        level: numberValue(category.level),
        leaf: booleanValue(category.is_leaf),
      }))
      .filter((category) => category.name !== null),
    variants,
    variantAxes: array(source.variant_axes)
      .map(record)
      .map((axis) => ({
        name: stringValue(axis.name),
        values: stringArray(axis.values),
      }))
      .filter((axis) => axis.name !== null),
    sizeChart: source.size_chart ?? null,
    availability: record(source.availability),
    region: record(source.region),
  };
}

function normalizeReviews(extract: JsonRecord) {
  const reviews = record(extract.reviews);
  const product = record(extract.product);
  const stats = record(product.stats);
  const rawItems = array(reviews.items);
  const sample = rawItems.slice(0, MAX_REVIEW_SAMPLE).map((rawReview) => {
    const review = record(rawReview);
    const timeMs = numberValue(review.time_ms);
    return {
      id: opaqueId(
        'review',
        stringValue(review.review_id) ??
          `${stringValue(review.author) ?? 'anonymous'}:${stringValue(review.text) ?? ''}`,
      ),
      rating: numberValue(review.rating),
      text: stringValue(review.text),
      author: stringValue(review.author),
      country: stringValue(review.country),
      variant: stringValue(review.variant),
      verifiedPurchase: booleanValue(review.verified_purchase),
      incentivized: booleanValue(review.incentivized),
      capturedAt: isoFromMilliseconds(timeMs),
      imageUrls: stringArray(review.images).filter((url) => /^https?:\/\//i.test(url)),
    };
  });

  return {
    total: numberValue(reviews.total ?? stats.review_count),
    capturedCount: rawItems.length,
    hasMore: booleanValue(reviews.has_more) ?? false,
    sampleType: 'captured_listing_sample' as const,
    sampleNotice:
      'Muestra capturada del listing; no representa necesariamente todas las reseñas.',
    truncated: rawItems.length > MAX_REVIEW_SAMPLE,
    sample,
  };
}

function normalizeMetrics(
  extract: JsonRecord,
  diagnostics: JsonRecord,
  artifacts: ArtifactInternal[],
) {
  const product = record(extract.product);
  const stats = record(product.stats);
  const variants = array(product.variants).map(record);
  const counts = record(diagnostics.counts);
  const reviews = record(extract.reviews);
  const totalStock = variants.reduce<number>((sum, variant) => {
    return sum + (numberValue(variant.stock) ?? 0);
  }, 0);

  return {
    rating: numberValue(stats.rating),
    soldCount: numberValue(stats.sold_count),
    reviewCount: numberValue(stats.review_count ?? reviews.total),
    reviewsCaptured: array(reviews.items).length,
    totalStock: variants.length > 0 ? totalStock : null,
    variantCount: variants.length,
    imageCount: numberValue(counts.images) ?? artifacts.filter((item) => item.kind === 'image').length,
    galleryCount:
      numberValue(counts.gallery) ??
      artifacts.filter((item) => item.role === 'gallery_image').length,
    videoCount: artifacts.filter((item) => item.kind === 'video').length,
    finalVideoCount: artifacts.filter((item) => item.finalVideo).length,
  };
}

async function loadNormalizedRun(
  run: RunContext,
  artifacts: ArtifactInternal[],
): Promise<NormalizedRunData> {
  const [extract, diagnosticsFile, brief, watermark, fondo, fondoChoice] = await Promise.all([
    readJsonFile(path.join(run.absolutePath, 'phu_product_extract.json')),
    readJsonFile(path.join(run.absolutePath, 'phu_diagnostics.json')),
    readJsonFile(path.join(run.absolutePath, 'phu_run_brief.json')),
    readJsonFile(path.join(run.absolutePath, 'phu_watermark_report.json')),
    readJsonFile(path.join(run.absolutePath, 'phu_NEEDS_FONDO.json')),
    readJsonFile(path.join(run.absolutePath, 'phu_fondo_choice.json')),
  ]);
  const diagnostics = Object.keys(diagnosticsFile).length
    ? diagnosticsFile
    : record(extract.diagnostics);

  return {
    extract,
    diagnostics,
    brief,
    watermark,
    fondo,
    fondoChoice,
    product: normalizeProduct(extract, artifacts),
    metrics: normalizeMetrics(extract, diagnostics, artifacts),
    reviews: normalizeReviews(extract),
  };
}

async function runStatus(
  run: RunContext,
  data: NormalizedRunData,
  finalVideo: ArtifactInternal | null,
  artifacts: ArtifactInternal[],
): Promise<RunStatus> {
  if (finalVideo) return 'complete';

  const watermarkStatus = stringValue(data.watermark.status) ?? '';
  if (
    watermarkStatus === 'audit_fail_needs_human' ||
    (await fileExists(path.join(run.absolutePath, 'phu_WATERMARK_AUDIT_FAIL.json')))
  ) {
    return 'needs_review';
  }

  const generationStarted = artifacts.some((artifact) =>
    [
      'product_bible',
      'product_bible_data',
      'video_reference',
      'source_video',
      'video_result',
    ].includes(artifact.role),
  );
  if (generationStarted || Object.keys(data.fondoChoice).length > 0) {
    return 'processing';
  }

  if (
    Object.keys(data.fondoChoice).length === 0 &&
    (stringValue(data.fondo.status) === 'needs_fondo' ||
      (await fileExists(path.join(run.absolutePath, 'phu_NEEDS_FONDO.json'))))
  ) {
    return 'awaiting_input';
  }
  if (data.diagnostics.ok === false) return 'failed';
  if (Object.keys(data.extract).length > 0) return 'processing';
  return 'discovered';
}

function latestUpdatedAt(run: RunContext, artifacts: ArtifactInternal[]): string {
  const timestamp = artifacts.reduce(
    (latest, artifact) => Math.max(latest, artifact.updatedAtMs),
    run.stats.mtimeMs,
  );
  return new Date(timestamp).toISOString();
}

async function buildRunSummary(
  run: RunContext,
  artifacts?: ArtifactInternal[],
  normalized?: NormalizedRunData,
) {
  const runArtifacts = artifacts ?? (await listArtifacts(run));
  const data = normalized ?? (await loadNormalizedRun(run, runArtifacts));
  const finalVideo = selectFinalVideo(runArtifacts);
  const status = await runStatus(run, data, finalVideo, runArtifacts);
  const thumbnail = runArtifacts.find((item) => item.role === 'gallery_image') ?? null;
  const transparentVariants = buildTransparentVariantMap(runArtifacts);

  return {
    id: run.id,
    status,
    complete: status === 'complete',
    productId: data.product.id,
    title: data.product.title,
    extractedAt: data.product.extractedAt,
    updatedAt: latestUpdatedAt(run, runArtifacts),
    completedAt: finalVideo?.updatedAt ?? null,
    durationSeconds: finalVideo?.durationSeconds ?? null,
    metrics: data.metrics,
    thumbnailArtifactId: thumbnail?.id ?? null,
    thumbnailUrl: thumbnail ? displayUrlFor(thumbnail, transparentVariants) : null,
    thumbnailOriginalUrl: thumbnail ? artifactUrl(thumbnail) : null,
    finalVideoArtifactId: finalVideo?.id ?? null,
    finalVideoUrl: finalVideo ? artifactUrl(finalVideo) : null,
    manifestUrl: `${API_BASE}/runs/${run.id}/manifest`,
  };
}

function buildNodes(
  run: RunContext,
  data: NormalizedRunData,
  artifacts: ArtifactInternal[],
) {
  const nodes: Array<Record<string, unknown>> = [];
  const push = (node: Record<string, unknown>) => {
    if (nodes.length < MAX_NODES) nodes.push(node);
  };
  const hero = artifacts.find((artifact) => artifact.role === 'gallery_image') ?? null;
  const finalVideos = orderedFinalVideos(artifacts);
  const finalVideo = finalVideos[0] ?? null;
  const transparentVariants = buildTransparentVariantMap(artifacts);

  push({
    id: opaqueId('node', `${run.directoryName}:product`),
    kind: 'product',
    eyebrow: 'PRODUCTO EXTRAÍDO',
    title: data.product.title,
    body: data.product.description[0] ?? null,
    artifactId: hero?.id ?? null,
    artifactUrl: hero ? artifactUrl(hero) : null,
    displayUrl: hero ? displayUrlFor(hero, transparentVariants) : null,
    transparentUrl: hero && transparentVariants.has(hero.id)
      ? displayUrlFor(hero, transparentVariants)
      : null,
    data: {
      productId: data.product.id,
      price: data.product.price,
      shipping: data.product.shipping,
      seller: data.product.seller,
    },
  });

  const metricNodes = [
    ['rating', 'CALIFICACIÓN', data.metrics.rating],
    ['sales', 'VENDIDOS', data.metrics.soldCount],
    [
      'reviews',
      'RESEÑAS',
      data.metrics.reviewCount,
      `${data.reviews.capturedCount} capturadas en la muestra`,
    ],
    ['stock', 'STOCK EXTRAÍDO', data.metrics.totalStock],
    ['variants', 'VARIANTES', data.metrics.variantCount],
  ] as const;
  for (const [key, title, value, note] of metricNodes) {
    if (value === null) continue;
    push({
      id: opaqueId('node', `${run.directoryName}:metric:${key}`),
      kind: 'metric',
      eyebrow: 'MÉTRICA EXTRAÍDA',
      title,
      value,
      body: note ?? null,
    });
  }

  for (const review of data.reviews.sample.slice(0, 6)) {
    push({
      id: opaqueId('node', `${run.directoryName}:review:${review.id}`),
      kind: 'review',
      eyebrow: 'MUESTRA CAPTURADA',
      title: review.rating !== null ? `${review.rating}/5` : 'Reseña',
      body: review.text,
      data: review,
    });
  }

  const mediaRoles = [
    'final_video',
    'source_video',
    'rejected_video',
    'video_result',
    'product_bible',
    'product_360_view',
    'storyboard',
    'direction_sheet',
    'gallery_image',
    'variant_image',
    'description_image',
    'size_chart',
    'reference_sheet',
    'source_screenshot',
  ];
  for (const role of mediaRoles) {
    const perRoleLimit: Record<string, number> = {
      final_video: 8,
      source_video: 8,
      rejected_video: 2,
      video_result: 8,
      gallery_image: 10,
      product_bible: 2,
      product_360_view: 8,
      storyboard: 2,
      direction_sheet: 1,
      variant_image: 5,
      description_image: 4,
      size_chart: 2,
      reference_sheet: 2,
      source_screenshot: 1,
    };
    const roleArtifacts = role === 'final_video'
      ? finalVideos.slice(0, perRoleLimit.final_video)
      : artifacts
          .filter((item) => item.role === role)
          .slice(0, perRoleLimit[role] ?? 1);
    for (const artifact of roleArtifacts) {
      const isCanonicalFinal = role === 'final_video' && artifact.id === finalVideo?.id;
      const eyebrow = isCanonicalFinal
        ? 'VIDEO FINAL PRINCIPAL'
        : role === 'final_video'
          ? 'VIDEO FINAL ALTERNATIVO'
          : role === 'source_video'
            ? 'VIDEO FUENTE'
            : role === 'rejected_video'
              ? 'VIDEO RECHAZADO POR QA'
            : role === 'video_result'
              ? 'RESULTADO DE VIDEO'
              : 'ARTEFACTO EXTRAÍDO';
      push({
        id: opaqueId('node', `${run.directoryName}:artifact:${artifact.id}`),
        kind: artifact.kind,
        eyebrow,
        title: artifact.label,
        artifactId: artifact.id,
        artifactUrl: artifactUrl(artifact),
        displayUrl: displayUrlFor(artifact, transparentVariants),
        transparentUrl: transparentVariants.has(artifact.id)
          ? displayUrlFor(artifact, transparentVariants)
          : null,
        renderMode: artifact.renderMode,
        role: artifact.role,
        durationSeconds: artifact.durationSeconds,
        canonical: isCanonicalFinal,
      });
    }
  }

  const documentRoles = [
    'product_extract',
    'normalized_data',
    'run_brief',
    'diagnostics',
    'variants_data',
    'prompt',
    'metadata',
    'report',
  ];
  for (const artifact of artifacts.filter((item) => documentRoles.includes(item.role))) {
    push({
      id: opaqueId('node', `${run.directoryName}:document:${artifact.id}`),
      kind: 'document',
      eyebrow: artifact.renderMode === 'code' ? 'CÓDIGO / JSON' : 'TEXTO PLANO',
      title: artifact.label,
      artifactId: artifact.id,
      artifactUrl: artifactUrl(artifact),
      renderMode: artifact.renderMode,
      role: artifact.role,
      mimeType: artifact.mimeType,
    });
  }

  return nodes.slice(0, MAX_NODES);
}

function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

function sendNotFound(response: Response, resource: 'run' | 'artifact') {
  response.status(404).json({
    error: {
      code: `${resource}_not_found`,
      message: resource === 'run' ? 'Fast Track run not found.' : 'Artifact not found.',
    },
  });
}

async function locateArtifact(
  root: RootContext,
  artifactId: string,
): Promise<ArtifactInternal | null> {
  if (!validateOpaqueId(artifactId)) return null;
  const runs = await listRuns(root);
  const artifactSets = await Promise.all(runs.map((run) => listArtifacts(run)));
  for (const artifacts of artifactSets) {
    const match = artifacts.find((candidate) => candidate.id === artifactId);
    if (match) return match;
  }
  return null;
}

export function createFastTrackRouter(options?: { outRoot?: string }): Router {
  const router = Router();
  const configuredRoot =
    options?.outRoot ?? process.env.FAST_TRACK_OUT_ROOT ?? DEFAULT_FAST_TRACK_OUT_ROOT;

  router.get(
    '/runs',
    asyncHandler(async (_request, response) => {
      const root = await loadRootContext(configuredRoot);
      const runs = await listRuns(root);
      const summaries = await Promise.all(runs.map((run) => buildRunSummary(run)));
      summaries.sort(
        (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );
      response.json({
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        rootAvailable: root.realPath !== null,
        runs: summaries,
      });
    }),
  );

  router.get(
    '/runs/:runId/manifest',
    asyncHandler(async (request, response) => {
      if (!validateOpaqueId(request.params.runId)) {
        response.status(400).json({
          error: { code: 'invalid_run_id', message: 'Invalid run identifier.' },
        });
        return;
      }

      const root = await loadRootContext(configuredRoot);
      const run = await findRun(root, request.params.runId);
      if (!run) {
        sendNotFound(response, 'run');
        return;
      }

      const artifacts = await listArtifacts(run);
      const data = await loadNormalizedRun(run, artifacts);
      const summary = await buildRunSummary(run, artifacts, data);
      const nodes = buildNodes(run, data, artifacts);
      const transparentVariants = buildTransparentVariantMap(artifacts);
      response.json({
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        run: summary,
        product: data.product,
        metrics: data.metrics,
        reviews: data.reviews,
        artifacts: artifacts.map((artifact) => toPublicArtifact(artifact, transparentVariants)),
        nodes,
        limits: {
          maxNodes: MAX_NODES,
          nodeCount: nodes.length,
          maxArtifacts: MAX_ARTIFACTS,
        },
      });
    }),
  );

  router.get(
    '/artifacts/:artifactId',
    asyncHandler(async (request, response, next) => {
      if (!validateOpaqueId(request.params.artifactId)) {
        response.status(400).json({
          error: { code: 'invalid_artifact_id', message: 'Invalid artifact identifier.' },
        });
        return;
      }

      const root = await loadRootContext(configuredRoot);
      const artifact = await locateArtifact(root, request.params.artifactId);
      if (!artifact) {
        sendNotFound(response, 'artifact');
        return;
      }

      let currentStats: Stats;
      try {
        const resolved = await realpath(artifact.absolutePath);
        const run = await findRun(root, artifact.runId);
        if (!run || !isPathInside(run.absolutePath, resolved)) {
          sendNotFound(response, 'artifact');
          return;
        }
        currentStats = await stat(resolved);
        if (!currentStats.isFile()) {
          sendNotFound(response, 'artifact');
          return;
        }
      } catch {
        sendNotFound(response, 'artifact');
        return;
      }

      response.setHeader('Content-Type', artifact.mimeType);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
      response.setHeader('Last-Modified', currentStats.mtime.toUTCString());
      response.setHeader(
        'Content-Disposition',
        `inline; filename="${artifact.filename.replace(/["\\\r\n]/g, '_')}"`,
      );

      const rangeHeader = request.headers.range;
      let start = 0;
      let end = Math.max(currentStats.size - 1, 0);
      if (artifact.kind === 'video') {
        response.setHeader('Accept-Ranges', 'bytes');
        if (rangeHeader) {
          const range = parseRange(rangeHeader, currentStats.size);
          if (!range) {
            response.status(416).setHeader('Content-Range', `bytes */${currentStats.size}`);
            response.end();
            return;
          }
          start = range.start;
          end = range.end;
          response.status(206);
          response.setHeader('Content-Range', `bytes ${start}-${end}/${currentStats.size}`);
        }
      }

      const contentLength = currentStats.size === 0 ? 0 : end - start + 1;
      response.setHeader('Content-Length', contentLength);
      if (contentLength === 0) {
        response.end();
        return;
      }
      const stream = createReadStream(artifact.absolutePath, { start, end });
      request.on('aborted', () => stream.destroy());
      stream.on('error', next);
      stream.pipe(response);
    }),
  );

  return router;
}
