import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
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

const API_BASE = '/api/product-worlds';
const ACTIVE_FAST_TRACK_ROOT = path.resolve(
  process.env.FAST_TRACK_OUT_ROOT ?? 'D:\\Proyectos\\automatizacion\\product-hold-ugc\\out',
);
const BUNDLED_WORLD_SOURCE_ROOT = path.resolve('public', 'product-worlds');
const BUNDLED_WORLD_BUILD_ROOT = path.resolve('dist', 'product-worlds');
const BUNDLED_WORLD_ROOT = existsSync(BUNDLED_WORLD_SOURCE_ROOT)
  ? BUNDLED_WORLD_SOURCE_ROOT
  : BUNDLED_WORLD_BUILD_ROOT;
const LOCAL_SCAN_ENABLED = process.env.PRODUCT_WORLD_LOCAL_SCAN !== '0';
const CATALOG_TTL_MS = 60_000;
const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_ARTIFACTS = 96;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{20,48}$/;

const LOCAL_SCAN_SPECS = [
  { root: ACTIVE_FAST_TRACK_ROOT, depth: 2 },
  { root: 'D:\\DatosAplicaciones\\Grok\\worktrees', depth: 5 },
  { root: 'D:\\Proyectos\\datos\\product_research', depth: 2 },
  { root: 'D:\\Proyectos\\automatizacion\\fluxo_completo\\runs', depth: 3 },
  { root: 'D:\\Proyectos\\automatizacion\\flujovideo\\recoleccion_de_datos', depth: 3 },
  { root: 'D:\\Proyectos\\datos\\product_research_claude\\campanas', depth: 3 },
  { root: 'D:\\Media\\Proyectos\\despedida_all_stars\\tiktok_shop_extract', depth: 1 },
] as const;

const SCAN_SPECS = [
  { root: BUNDLED_WORLD_ROOT, depth: 2 },
  ...(LOCAL_SCAN_ENABLED ? LOCAL_SCAN_SPECS : []),
] as const;

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  'frames',
  'frames_in',
  'frames_out',
  'frames_out_x2',
  'este_grok_frame_upscale',
  'este_realesrgan',
  'este_realesrgan_4k',
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
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

const PHU_ARTIFACT_DIRECTORIES = [
  '',
  'phu_images/gallery',
  'phu_images/gallery_clean',
  'phu_images/variants',
  'phu_images/description',
  'phu_images/sizechart',
  'phu_images/ref_sheets',
  'phu_sizechart',
  'phu_bible',
  'phu_bible/approved',
  'phu_video',
  'phu_video/phu_refs_r2v_16x9',
] as const;

const SHORT_NAMES: Readonly<Record<string, string>> = {
  '1735785778453579666': 'Gorra ABZ',
  '1733715765363574144': 'Barbas y Dandy',
  '1734803589751932781': 'Camisa de lino',
  '1732992473481512755': 'Chaqueta café',
  '1736424138891560162': 'Gorra Báez x Shifu',
  '1735573357270501291': 'Eucerin anti-manchas',
  '1735461279172822273': 'Gorra ABZ total black',
  '1734505189847958608': 'Gorra Dandy Sad Boyz',
  '1734315837005793240': 'Gorra de barajas',
  '1735431805125363672': 'Gorra Pantera Negra',
  '1732224164373759442': 'Botas de trabajo NIEION',
  '1734117758252582255': 'Pack 3 playeras',
  '1734306060764546755': 'Reloj vintage',
  '1732916357122458811': 'Sudadera old money',
  '1735790202357712786': 'Dandy For All Our Haters',
  '1735729518941799829': 'Sudadera HG BSS',
  '1736106453358118081': 'Zapatillas altas',
  '1736135567409514036': 'Camisa slim de cuadros',
};

type JsonRecord = Record<string, unknown>;
type ArtifactKind = 'image' | 'video' | 'json' | 'text' | 'table';

interface HeroCandidate {
  absolutePath: string;
  score: number;
  hasAlpha: boolean;
  mimeType: string;
  size: number;
  updatedAtMs: number;
}

interface ProductSource {
  productId: string;
  title: string;
  extractPath: string;
  rootPath: string;
  phu: boolean;
  modifiedAtMs: number;
  data: JsonRecord;
  hero: HeroCandidate | null;
  activeFastTrackRunId: string | null;
}

interface CatalogWorldInternal {
  id: string;
  productId: string;
  name: string;
  title: string;
  heroId: string;
  heroUrl: string;
  heroHasAlpha: boolean;
  sourceCount: number;
  updatedAt: string;
  manifestUrl: string;
  canonicalSource: ProductSource;
  sources: ProductSource[];
  activeFastTrackRunId: string | null;
}

interface RegisteredFile {
  id: string;
  absolutePath: string;
  mimeType: string;
  size: number;
  updatedAtMs: number;
}

interface CatalogSnapshot {
  builtAt: number;
  worlds: CatalogWorldInternal[];
}

export interface ProductWorldLookup {
  id: string;
  productId: string;
  name: string;
  title: string;
  heroUrl: string;
  heroHasAlpha: boolean;
  sourceCount: number;
  updatedAt: string;
  manifestUrl: string;
}

interface GenericArtifact extends RegisteredFile {
  filename: string;
  relativePath: string;
  kind: ArtifactKind;
  role: string;
  label: string;
  durationSeconds: number | null;
  hasAlpha: boolean;
}

let catalogCache: CatalogSnapshot | null = null;
const fileRegistry = new Map<string, RegisteredFile>();

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function opaqueId(scope: string, value: string): string {
  return createHash('sha256')
    .update(`product-world-catalog:v1:${scope}:${value}`)
    .digest('base64url')
    .slice(0, 28);
}

function fastTrackRunId(directoryName: string): string {
  return createHash('sha256')
    .update(`product-world-fast-track:v1:run:${directoryName}`)
    .digest('base64url')
    .slice(0, 28);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function findExtracts(rootPath: string, maxDepth: number): Promise<string[]> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(rootPath);
  } catch {
    return [];
  }

  const found: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (
        entry.isFile()
        && ['product_extract.json', 'phu_product_extract.json', 'fv_product_extract.json'].includes(entry.name)
      ) {
        found.push(absolutePath);
        continue;
      }
      if (
        entry.isDirectory()
        && depth < maxDepth
        && !EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())
      ) {
        await visit(absolutePath, depth + 1);
      }
    }
  };

  await visit(resolvedRoot, 0);
  return found;
}

async function readExtract(filePath: string): Promise<JsonRecord> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size > MAX_EXTRACT_BYTES) return {};
    return record(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    return {};
  }
}

async function pngHasAlpha(filePath: string): Promise<boolean> {
  if (path.extname(filePath).toLowerCase() !== '.png') return false;
  try {
    const bytes = await readFile(filePath);
    return bytes.length > 25 && [4, 6].includes(bytes[25]);
  } catch {
    return false;
  }
}

async function filesIn(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function heroScore(filePath: string, hasAlpha: boolean): number {
  const filename = path.basename(filePath).toLowerCase();
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  let score = 0;
  if (hasAlpha) score += 400;
  if (filename === 'gallery_01_transparent.png') score += 360;
  else if (filename === '10_variant.jpg' || filename === '10_variant.png') score += 330;
  else if (/^(01_)?gallery[_-]?0?1\b/.test(filename)) score += 280;
  else if (filename.includes('variant')) score += 190;
  else if (filename.includes('gallery')) score += 160;
  else if (filename.includes('description')) score += 80;
  if (normalized.includes('/gallery_clean/')) score += 220;
  if (normalized.includes('/out_vt_fresh/')) score += 80;
  if (filename.includes('screenshot') || filename.includes('sizechart')) score -= 250;
  return score;
}

async function findHero(extractPath: string, phu: boolean): Promise<HeroCandidate | null> {
  const root = path.dirname(extractPath);
  const fv = path.basename(extractPath).toLowerCase() === 'fv_product_extract.json';
  const directories = phu
    ? [
        path.join(root, 'phu_images', 'gallery_clean'),
        path.join(root, 'phu_images', 'gallery'),
        path.join(root, 'phu_images', 'variants'),
      ]
    : fv
      ? [
          path.join(root, 'fv_images', 'gallery'),
          path.join(root, 'fv_images', 'variants'),
          path.join(root, 'fv_images', 'description'),
        ]
      : [path.join(root, 'images'), root];
  const candidates: HeroCandidate[] = [];

  for (const directory of directories) {
    for (const filePath of await filesIn(directory)) {
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType?.startsWith('image/')) continue;
      const fileStats = await stat(filePath);
      const hasAlpha = await pngHasAlpha(filePath);
      candidates.push({
        absolutePath: filePath,
        score: heroScore(filePath, hasAlpha),
        hasAlpha,
        mimeType,
        size: fileStats.size,
        updatedAtMs: fileStats.mtimeMs,
      });
    }
  }

  return candidates.sort((left, right) => (
    right.score - left.score
    || right.updatedAtMs - left.updatedAtMs
    || left.absolutePath.localeCompare(right.absolutePath)
  ))[0] ?? null;
}

async function buildSource(extractPath: string): Promise<ProductSource | null> {
  const data = await readExtract(extractPath);
  const product = record(data.product);
  const productId = text(product.id);
  const title = text(product.title);
  if (!productId || !title) return null;

  const fileStats = await stat(extractPath);
  const phu = path.basename(extractPath).toLowerCase() === 'phu_product_extract.json';
  const rootPath = path.dirname(extractPath);
  const activeFastTrackRunId = phu && path.dirname(rootPath).toLowerCase() === ACTIVE_FAST_TRACK_ROOT.toLowerCase()
    ? fastTrackRunId(path.basename(rootPath))
    : null;

  return {
    productId,
    title,
    extractPath,
    rootPath,
    phu,
    modifiedAtMs: fileStats.mtimeMs,
    data,
    hero: await findHero(extractPath, phu),
    activeFastTrackRunId,
  };
}

function sourceScore(source: ProductSource): number {
  const normalized = source.rootPath.replaceAll('\\', '/').toLowerCase();
  return (source.activeFastTrackRunId ? 1_000 : 0)
    + (normalized.includes('/out_vt_fresh') ? 500 : 0)
    + (source.hero?.score ?? -1_000)
    + Math.floor(source.modifiedAtMs / 1_000_000_000);
}

function registerFile(filePath: string, mimeType: string, size: number, updatedAtMs: number): RegisteredFile {
  const id = opaqueId('file', filePath.toLowerCase());
  const registered = { id, absolutePath: filePath, mimeType, size, updatedAtMs };
  fileRegistry.set(id, registered);
  return registered;
}

async function buildCatalogSnapshot(): Promise<CatalogSnapshot> {
  const extractPaths = (await Promise.all(
    SCAN_SPECS.map((spec) => findExtracts(spec.root, spec.depth)),
  )).flat();
  const sources = (await Promise.all(
    [...new Set(extractPaths)].map(buildSource),
  )).filter((source): source is ProductSource => source !== null);
  const groups = new Map<string, ProductSource[]>();

  for (const source of sources) {
    const group = groups.get(source.productId) ?? [];
    group.push(source);
    groups.set(source.productId, group);
  }

  const worlds: CatalogWorldInternal[] = [];
  for (const [productId, productSources] of groups) {
    const sourcesByScore = [...productSources].sort((left, right) => sourceScore(right) - sourceScore(left));
    const canonicalSource = sourcesByScore[0];
    const heroSource = sourcesByScore.find((source) => source.hero) ?? null;
    if (!canonicalSource || !heroSource?.hero) continue;

    const hero = heroSource.hero;
    const registeredHero = registerFile(hero.absolutePath, hero.mimeType, hero.size, hero.updatedAtMs);
    const activeFastTrackRunId = sourcesByScore.find((source) => source.activeFastTrackRunId)?.activeFastTrackRunId ?? null;
    worlds.push({
      id: productId,
      productId,
      name: SHORT_NAMES[productId] ?? canonicalSource.title.split(/\s+/).slice(0, 6).join(' '),
      title: canonicalSource.title,
      heroId: registeredHero.id,
      heroUrl: `${API_BASE}/heroes/${registeredHero.id}?v=${Math.round(hero.updatedAtMs)}-${hero.size}`,
      heroHasAlpha: hero.hasAlpha,
      sourceCount: productSources.length,
      updatedAt: new Date(Math.max(...productSources.map((source) => source.modifiedAtMs))).toISOString(),
      manifestUrl: `${API_BASE}/worlds/${productId}/manifest`,
      canonicalSource,
      sources: productSources,
      activeFastTrackRunId,
    });
  }

  worlds.sort((left, right) => left.name.localeCompare(right.name, 'es'));
  return { builtAt: Date.now(), worlds };
}

async function getCatalogSnapshot(force = false): Promise<CatalogSnapshot> {
  if (!force && catalogCache && Date.now() - catalogCache.builtAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  catalogCache = await buildCatalogSnapshot();
  return catalogCache;
}

function publicCatalogWorld(world: CatalogWorldInternal): ProductWorldLookup {
  return {
    id: world.id,
    productId: world.productId,
    name: world.name,
    title: world.title,
    heroUrl: world.heroUrl,
    heroHasAlpha: world.heroHasAlpha,
    sourceCount: world.sourceCount,
    updatedAt: world.updatedAt,
    manifestUrl: world.manifestUrl,
  };
}

export async function findProductWorldByProductId(
  productId: string,
  forceRefresh = true,
): Promise<ProductWorldLookup | null> {
  if (!/^\d{15,25}$/.test(productId)) return null;
  const snapshot = await getCatalogSnapshot(forceRefresh);
  const world = snapshot.worlds.find((candidate) => candidate.productId === productId);
  return world ? publicCatalogWorld(world) : null;
}

function isFinalPhuVideo(filename: string): boolean {
  return /^phu_product_hold_/.test(filename)
    && /(?:^|[_-])(10|15)s(?:[_-]|\.)/.test(filename)
    && /(?:^|[_-])1080p(?:[_-]|\.)/.test(filename)
    && !/(?:raw|720p|sample|partial|noaudio|source_reference)/.test(filename);
}

function artifactRole(relativePath: string, extension: string): string {
  const value = relativePath.replaceAll('\\', '/').toLowerCase();
  const filename = path.basename(value);
  if (value.startsWith('phu_video/qa_rejected_handoff_v1/')) {
    return /(?:raw|720p)/.test(filename) ? 'source_video' : 'rejected_video';
  }
  if (value.startsWith('phu_production_15s/bibles/product-360/')) {
    return extension === '.png' ? 'product_360_view' : 'product_360_data';
  }
  if (value === 'phu_production_15s/bibles/product-bible-visual.png') return 'product_bible';
  if (value.startsWith('phu_production_15s/storyboard/')) {
    return extension === '.png' ? 'storyboard' : filename.includes('prompt') ? 'prompt' : 'storyboard_data';
  }
  if (value.startsWith('phu_production_15s/handoff/')) return 'video_handoff';
  if (value.startsWith('phu_production_15s/prompts/')) return 'prompt';
  if (value === 'phu_production_15s/direction-sheet.png') return 'direction_sheet';
  if (value.startsWith('phu_production_15s/bibles/')) {
    return extension === '.png' ? 'product_bible' : 'product_bible_data';
  }
  if (value.startsWith('phu_production_15s/')) return 'production_metadata';
  if (filename.includes('product_extract')) return 'product_extract';
  if (filename.includes('normalized')) return 'normalized_data';
  if (filename.includes('diagnostic')) return 'diagnostics';
  if (filename.includes('variant') && extension === '.csv') return 'variants_data';
  if (filename.includes('bible')) return 'product_bible';
  if (filename.includes('sizechart') || filename.includes('size_chart')) return 'size_chart';
  if (filename.includes('screenshot')) return 'source_screenshot';
  if (extension === '.mp4' || extension === '.mov' || extension === '.webm') {
    if (filename.startsWith('phu_product_hold_')) {
      if (isFinalPhuVideo(filename)) return 'final_video';
      return /(?:raw|720p|sample|partial|noaudio|source_reference)/.test(filename)
        ? 'source_video'
        : 'video_result';
    }
    return filename.includes('final') ? 'final_video' : 'video_result';
  }
  if (filename.includes('variant')) return 'variant_image';
  if (filename.includes('description') || filename.startsWith('desc_')) return 'description_image';
  if (filename.includes('gallery')) return 'gallery_image';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) return 'supporting_image';
  return 'supporting_artifact';
}

function artifactKind(extension: string): ArtifactKind {
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) return 'image';
  if (['.mp4', '.mov', '.webm'].includes(extension)) return 'video';
  if (extension === '.json') return 'json';
  if (extension === '.csv') return 'table';
  return 'text';
}

function labelFromFilename(filename: string): string {
  return path.parse(filename).name
    .replaceAll(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function collectArtifactPaths(source: ProductSource): Promise<string[]> {
  const fv = path.basename(source.extractPath).toLowerCase() === 'fv_product_extract.json';
  const directories = source.phu
    ? PHU_ARTIFACT_DIRECTORIES.map((directory) => path.join(source.rootPath, directory))
    : fv
      ? [
          source.rootPath,
          path.join(source.rootPath, 'fv_images', 'gallery'),
          path.join(source.rootPath, 'fv_images', 'variants'),
          path.join(source.rootPath, 'fv_images', 'description'),
          path.join(source.rootPath, 'fv_video'),
        ]
      : [source.rootPath, path.join(source.rootPath, 'images'), path.join(source.rootPath, 'sizechart')];
  const paths: string[] = [];
  for (const directory of directories) paths.push(...await filesIn(directory));
  if (source.phu) {
    paths.push(...await listAllowedPhuProductionArtifacts(source.rootPath));
    paths.push(...await listAllowedPhuRejectedVideoArtifacts(source.rootPath));
  }
  return [...new Set(paths)].filter((filePath) => Boolean(MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]));
}

async function buildGenericArtifacts(world: CatalogWorldInternal): Promise<GenericArtifact[]> {
  const source = world.canonicalSource;
  const filePaths = await collectArtifactPaths(source);
  const artifacts: GenericArtifact[] = [];
  const seenImageDigests = new Set<string>();
  const videoQaPolicy = await loadPhuVideoQaPolicy(source.rootPath);

  for (const filePath of filePaths) {
    if (artifacts.length >= MAX_MANIFEST_ARTIFACTS) break;
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) continue;
    const fileStats = await stat(filePath);
    const kind = artifactKind(extension);
    const relativePath = path.relative(source.rootPath, filePath);
    if (videoQaPolicy.required && isPrivatePhuProductionArtifact(relativePath)) continue;
    const hasAlpha = kind === 'image' && extension === '.png'
      ? await pngHasAlpha(filePath)
      : false;
    if (kind === 'image' && fileStats.size <= 8 * 1024 * 1024) {
      const digest = createHash('sha256').update(await readFile(filePath)).digest('base64url');
      if (seenImageDigests.has(digest)) continue;
      seenImageDigests.add(digest);
    }

    const registered = registerFile(filePath, mimeType, fileStats.size, fileStats.mtimeMs);
    const filename = path.basename(filePath);
    const durationMatch = filename.match(/(?:^|[_-])(\d{1,3})s(?:[_\-.]|$)/i);
    let role = artifactRole(relativePath, extension);
    if (role === 'final_video') {
      const qaStatus = await evaluatePhuVideoQa(
        videoQaPolicy,
        relativePath,
        filePath,
        fileStats.size,
        fileStats.mtimeMs,
      );
      if (qaStatus === 'rejected') role = 'rejected_video';
      else if (qaStatus === 'pending') role = 'video_result';
    }
    artifacts.push({
      ...registered,
      filename,
      relativePath,
      kind,
      role,
      label: labelFromFilename(filename),
      durationSeconds: durationMatch ? Number(durationMatch[1]) : null,
      hasAlpha,
    });
  }

  return artifacts;
}

function publicArtifact(artifact: GenericArtifact) {
  const url = `${API_BASE}/artifacts/${artifact.id}?v=${Math.round(artifact.updatedAtMs)}-${artifact.size}`;
  const isTransparentImage = artifact.kind === 'image' && artifact.hasAlpha;
  return {
    id: artifact.id,
    kind: artifact.kind,
    renderMode: artifact.kind === 'image' ? 'image' : artifact.kind === 'video' ? 'video' : artifact.kind === 'table' ? 'table' : artifact.kind === 'json' ? 'code' : 'text',
    role: artifact.role,
    label: artifact.label,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    size: artifact.size,
    updatedAt: new Date(artifact.updatedAtMs).toISOString(),
    durationSeconds: artifact.durationSeconds,
    url,
    displayUrl: artifact.kind === 'image' ? url : undefined,
    transparentUrl: isTransparentImage ? url : undefined,
    backgroundMode: artifact.kind === 'image'
      ? isTransparentImage ? 'transparent' : 'preserved'
      : undefined,
  };
}

function metricValue(product: JsonRecord, key: string): number | null {
  return numeric(record(product.stats)[key]);
}

async function buildGenericManifest(world: CatalogWorldInternal) {
  const source = world.canonicalSource;
  const product = record(source.data.product);
  const artifacts = await buildGenericArtifacts(world);
  const publicArtifacts = artifacts.map(publicArtifact);
  const heroArtifact = artifacts.find((artifact) => artifact.absolutePath === fileRegistry.get(world.heroId)?.absolutePath)
    ?? artifacts.find((artifact) => artifact.kind === 'image')
    ?? null;
  const finalVideos = artifacts
    .filter((artifact) => artifact.role === 'final_video')
    .sort((left, right) => (
      (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0)
      || right.updatedAtMs - left.updatedAtMs
      || left.filename.localeCompare(right.filename)
    ));
  const finalVideo = finalVideos[0]
    ?? artifacts.find((artifact) => artifact.kind === 'video')
    ?? null;
  const rating = metricValue(product, 'rating');
  const soldCount = metricValue(product, 'sold_count');
  const reviewCount = metricValue(product, 'review_count');
  const variants = array(product.variants);
  const imageCount = artifacts.filter((artifact) => artifact.kind === 'image').length;
  const videoCount = artifacts.filter((artifact) => artifact.kind === 'video').length;
  const nodes: Array<Record<string, unknown>> = [{
    id: opaqueId('node', `${world.productId}:product`),
    kind: 'product',
    title: world.title,
    body: array(product.description).map((value) => text(value)).filter(Boolean)[0] ?? null,
    artifactId: heroArtifact?.id ?? null,
    displayUrl: world.heroUrl,
    data: { productId: world.productId, price: product.price, seller: product.seller },
  }];

  for (const artifact of artifacts.slice(0, 48)) {
    nodes.push({
      id: opaqueId('node', `${world.productId}:${artifact.id}`),
      kind: artifact.kind,
      title: artifact.label,
      artifactId: artifact.id,
      artifactUrl: `${API_BASE}/artifacts/${artifact.id}`,
      displayUrl: `${API_BASE}/artifacts/${artifact.id}`,
      role: artifact.role,
      durationSeconds: artifact.durationSeconds,
    });
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    run: {
      id: world.id,
      productId: world.productId,
      title: world.title,
      status: finalVideo ? 'complete' : 'processing',
      updatedAt: world.updatedAt,
      completedAt: finalVideo ? new Date(finalVideo.updatedAtMs).toISOString() : null,
      durationSeconds: finalVideo?.durationSeconds ?? null,
      finalVideoArtifactId: finalVideo?.id ?? null,
      finalVideoUrl: finalVideo ? `${API_BASE}/artifacts/${finalVideo.id}` : null,
    },
    product: {
      ...product,
      id: world.productId,
      title: world.title,
      heroUrl: world.heroUrl,
      heroDisplayUrl: world.heroUrl,
      heroTransparentUrl: world.heroHasAlpha ? world.heroUrl : null,
    },
    metrics: {
      rating,
      soldCount,
      reviewCount,
      totalStock: variants.reduce<number>((total, variant) => total + (numeric(record(variant).stock) ?? 0), 0),
      variantCount: variants.length,
      imageCount,
      videoCount,
      finalVideoCount: finalVideos.length,
    },
    reviews: { total: reviewCount ?? 0, capturedCount: 0, hasMore: false, sample: [] },
    artifacts: publicArtifacts,
    nodes,
  };
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
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
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
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

async function sendRegisteredFile(request: Request, response: Response, file: RegisteredFile): Promise<void> {
  if (!await pathExists(file.absolutePath)) {
    response.status(404).json({ error: { code: 'file_not_found', message: 'Product file not found.' } });
    return;
  }

  response.setHeader('Content-Type', file.mimeType);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, file.size);
    if (!range) {
      response.status(416).setHeader('Content-Range', `bytes */${file.size}`).end();
      return;
    }
    response.status(206);
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    response.setHeader('Content-Length', String(range.end - range.start + 1));
    createReadStream(file.absolutePath, { start: range.start, end: range.end }).pipe(response);
    return;
  }
  response.setHeader('Content-Length', String(file.size));
  createReadStream(file.absolutePath).pipe(response);
}

export function createProductWorldRouter(): Router {
  const router = Router();

  router.get('/catalog', asyncHandler(async (request, response) => {
    const snapshot = await getCatalogSnapshot(request.query.refresh === '1');
    response.json({
      schemaVersion: '1.0',
      generatedAt: new Date(snapshot.builtAt).toISOString(),
      worlds: snapshot.worlds.map(publicCatalogWorld),
    });
  }));

  router.get('/worlds/:productId/manifest', asyncHandler(async (request, response) => {
    let snapshot = await getCatalogSnapshot();
    let world = snapshot.worlds.find((candidate) => candidate.productId === request.params.productId);
    const activeSource = world?.sources.find(
      (source) => source.activeFastTrackRunId === world?.activeFastTrackRunId,
    );
    if (world?.activeFastTrackRunId && (!activeSource || !existsSync(activeSource.extractPath))) {
      snapshot = await getCatalogSnapshot(true);
      world = snapshot.worlds.find((candidate) => candidate.productId === request.params.productId);
    }
    if (!world) {
      response.status(404).json({ error: { code: 'world_not_found', message: 'Product world not found.' } });
      return;
    }
    if (world.activeFastTrackRunId) {
      response.redirect(307, `/api/fast-track/runs/${world.activeFastTrackRunId}/manifest`);
      return;
    }
    response.json(await buildGenericManifest(world));
  }));

  router.get('/heroes/:heroId', asyncHandler(async (request, response) => {
    if (!OPAQUE_ID_PATTERN.test(request.params.heroId)) {
      response.status(400).json({ error: { code: 'invalid_hero_id', message: 'Invalid hero identifier.' } });
      return;
    }
    await getCatalogSnapshot();
    const hero = fileRegistry.get(request.params.heroId);
    if (!hero || !hero.mimeType.startsWith('image/')) {
      response.status(404).json({ error: { code: 'hero_not_found', message: 'Product hero not found.' } });
      return;
    }
    await sendRegisteredFile(request, response, hero);
  }));

  router.get('/artifacts/:artifactId', asyncHandler(async (request, response) => {
    if (!OPAQUE_ID_PATTERN.test(request.params.artifactId)) {
      response.status(400).json({ error: { code: 'invalid_artifact_id', message: 'Invalid artifact identifier.' } });
      return;
    }
    const artifact = fileRegistry.get(request.params.artifactId);
    if (!artifact) {
      response.status(404).json({ error: { code: 'artifact_not_found', message: 'Product artifact not found.' } });
      return;
    }
    await sendRegisteredFile(request, response, artifact);
  }));

  return router;
}
