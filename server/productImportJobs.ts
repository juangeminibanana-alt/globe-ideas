import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  Router,
  json,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  findProductWorldByProductId,
  type ProductWorldLookup,
} from './productWorldCatalog';

const DEFAULT_FLOW_ROOT = 'D:\\Proyectos\\automatizacion\\product-hold-ugc';
const MAX_BODY_BYTES = '16kb';
const MAX_URL_LENGTH = 2_048;
const MAX_REDIRECTS = 6;
const MAX_RESOLUTION_BYTES = 256 * 1_024;
const RESOLUTION_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 12 * 60_000;
const POSTPROCESS_TIMEOUT_MS = 5 * 60_000;
const MAX_RETAINED_JOBS = 50;
const PRODUCT_ID_PATTERN = /^\d{15,25}$/;

type InternalImportStatus =
  | 'queued'
  | 'running'
  | 'needs-input'
  | 'complete'
  | 'failed';

type ProductImportStage =
  | 'resolve-source'
  | 'extract-product'
  | 'clean-images'
  | 'research-ready'
  | 'build-360-coverage'
  | 'generate-product-bible'
  | 'generate-storyboard'
  | 'select-seven-references'
  | 'generate-grok-video'
  | 'upscale-video'
  | 'publish-world';

interface ProductImportGates {
  coverage360: {
    ready: boolean;
    usableFullProductAngles: number;
    requiredAngles: number;
    missingAngles: string[];
  };
  videoReferences: {
    ready: boolean;
    total: number;
    productBible: number;
    storyboard: number;
    fullProductAngles: number;
  };
}

interface ProductImportJobInternal {
  id: string;
  sourceUrl: string;
  status: InternalImportStatus;
  stage: ProductImportStage;
  progress: number | null;
  terminal: boolean;
  existing: boolean;
  productId: string | null;
  world: ProductWorldLookup | null;
  message: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  outputPath: string | null;
  gates: ProductImportGates;
}

export interface ProductImportJob {
  id: string;
  sourceUrl: string;
  status: 'queued' | 'running' | 'needs-input' | 'failed' | 'complete';
  stage: ProductImportStage;
  progress: number | null;
  terminal: boolean;
  existing: boolean;
  productId: string | null;
  world: ProductWorldLookup | null;
  manifestUrl: string | null;
  mergedIntoExistingWorld: boolean;
  gates: ProductImportGates;
  message: string;
  error: { code: string; message: string; retriable: boolean } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface ProductImportJobsOptions {
  flowRoot?: string;
  pythonExecutable?: string;
}

interface ProcessResult {
  code: number;
  outputTail: string;
}

class ImportFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly internalDetail?: string,
  ) {
    super(message);
  }
}

const jobs = new Map<string, ProductImportJobInternal>();
let activeJobId: string | null = null;
const executingJobIds = new Set<string>();
let persistenceRoot = path.join(DEFAULT_FLOW_ROOT, 'out', '.product-import-jobs');
let initializedFlowRoot: string | null = null;
let initializationPromise: Promise<void> | null = null;

const REQUIRED_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;
const ANGLE_LABELS = new Map<number, string>([
  [0, 'front'],
  [45, 'front-left'],
  [90, 'left-profile'],
  [135, 'rear-left'],
  [180, 'rear'],
  [225, 'rear-right'],
  [270, 'right-profile'],
  [315, 'front-right'],
]);

function emptyGates(): ProductImportGates {
  return {
    coverage360: {
      ready: false,
      usableFullProductAngles: 0,
      requiredAngles: REQUIRED_ANGLES.length,
      missingAngles: REQUIRED_ANGLES.map((angle) => ANGLE_LABELS.get(angle) ?? String(angle)),
    },
    videoReferences: {
      ready: false,
      total: 0,
      productBible: 0,
      storyboard: 0,
      fullProductAngles: 0,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicJob(job: ProductImportJobInternal): ProductImportJob {
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    terminal: job.terminal,
    existing: job.existing,
    productId: job.productId,
    world: job.world,
    manifestUrl: job.world?.manifestUrl ?? null,
    mergedIntoExistingWorld: job.existing,
    gates: job.gates,
    message: job.message,
    error: job.errorCode
      ? { code: job.errorCode, message: job.message, retriable: job.errorCode !== 'invalid_source_url' }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

async function persistJob(job: ProductImportJobInternal): Promise<void> {
  await mkdir(persistenceRoot, { recursive: true });
  const destination = path.join(persistenceRoot, `${job.id}.json`);
  const temporary = path.join(
    persistenceRoot,
    `.${job.id}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, destination);
}

async function updateJob(
  job: ProductImportJobInternal,
  status: InternalImportStatus,
  stage: ProductImportStage,
  progress: number | null,
  message: string,
): Promise<void> {
  job.status = status;
  job.stage = stage;
  job.progress = progress;
  job.message = message;
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
}

async function finishJob(
  job: ProductImportJobInternal,
  world: ProductWorldLookup,
  existing: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  job.status = 'complete';
  job.stage = 'publish-world';
  job.progress = 100;
  job.terminal = true;
  job.existing = existing;
  job.world = world;
  job.productId = world.productId;
  job.message = existing
    ? 'El mundo existente ya contiene la producción completa; no se repitió la extracción.'
    : 'Investigación, referencias y video final publicados en el mundo del producto.';
  job.updatedAt = now;
  job.completedAt = now;
  if (activeJobId === job.id) activeJobId = null;
  await persistJob(job);
}

async function failJob(job: ProductImportJobInternal, failure: unknown): Promise<void> {
  const known = failure instanceof ImportFailure
    ? failure
    : new ImportFailure('import_failed', 'No se pudo completar la extracción del producto.');
  const now = new Date().toISOString();
  job.status = 'failed';
  job.terminal = true;
  job.errorCode = known.code;
  job.message = known.message;
  job.updatedAt = now;
  job.completedAt = now;
  if (known.internalDetail) {
    console.error(`[product-import:${job.id}] ${known.code}: ${known.internalDetail}`);
  } else if (!(failure instanceof ImportFailure)) {
    console.error(`[product-import:${job.id}]`, failure);
  }
  if (activeJobId === job.id) activeJobId = null;
  await persistJob(job).catch((persistenceError) => {
    console.error(`[product-import:${job.id}] could not persist failure`, persistenceError);
  });
}

function pruneJobs(): void {
  if (jobs.size <= MAX_RETAINED_JOBS) return;
  const removable = [...jobs.values()]
    .filter((job) => job.terminal && job.id !== activeJobId)
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  while (jobs.size > MAX_RETAINED_JOBS && removable.length) {
    const candidate = removable.shift();
    if (candidate) jobs.delete(candidate.id);
  }
}

function stageFromUnknown(value: unknown): ProductImportStage {
  const candidate = typeof value === 'string' ? value : '';
  const stages = new Set<ProductImportStage>([
    'resolve-source',
    'extract-product',
    'clean-images',
    'research-ready',
    'build-360-coverage',
    'generate-product-bible',
    'generate-storyboard',
    'select-seven-references',
    'generate-grok-video',
    'upscale-video',
    'publish-world',
  ]);
  return stages.has(candidate as ProductImportStage)
    ? candidate as ProductImportStage
    : 'resolve-source';
}

function hydratedJob(value: unknown): ProductImportJobInternal | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const productId = typeof value.productId === 'string' && PRODUCT_ID_PATTERN.test(value.productId)
    ? value.productId
    : null;
  if (!id) return null;

  const rawStatus = typeof value.status === 'string' ? value.status : 'queued';
  const status: InternalImportStatus = rawStatus === 'complete'
    ? 'complete'
    : rawStatus === 'failed'
      ? 'failed'
      : rawStatus === 'needs-input'
        ? 'needs-input'
        : rawStatus === 'queued'
          ? 'queued'
          : 'running';
  const now = new Date().toISOString();
  const gatesValue = isRecord(value.gates) ? value.gates : {};
  const coverageValue = isRecord(gatesValue.coverage360) ? gatesValue.coverage360 : {};
  const referencesValue = isRecord(gatesValue.videoReferences) ? gatesValue.videoReferences : {};
  const gates = emptyGates();
  gates.coverage360.ready = coverageValue.ready === true;
  gates.coverage360.usableFullProductAngles = typeof coverageValue.usableFullProductAngles === 'number'
    ? coverageValue.usableFullProductAngles
    : 0;
  gates.coverage360.missingAngles = Array.isArray(coverageValue.missingAngles)
    ? coverageValue.missingAngles.filter((item): item is string => typeof item === 'string')
    : gates.coverage360.missingAngles;
  gates.videoReferences.ready = referencesValue.ready === true;
  gates.videoReferences.total = typeof referencesValue.total === 'number' ? referencesValue.total : 0;
  gates.videoReferences.productBible = typeof referencesValue.productBible === 'number'
    ? referencesValue.productBible
    : 0;
  gates.videoReferences.storyboard = typeof referencesValue.storyboard === 'number'
    ? referencesValue.storyboard
    : 0;
  gates.videoReferences.fullProductAngles = typeof referencesValue.fullProductAngles === 'number'
    ? referencesValue.fullProductAngles
    : 0;

  const stage = rawStatus === 'research-ready'
    ? 'build-360-coverage'
    : stageFromUnknown(value.stage);
  return {
    id,
    sourceUrl: typeof value.sourceUrl === 'string'
      ? value.sourceUrl
      : productId ? `https://shop.tiktok.com/view/product/${productId}` : '',
    status: rawStatus === 'research-ready' ? 'needs-input' : status,
    stage,
    progress: typeof value.progress === 'number'
      ? Math.max(0, Math.min(100, value.progress))
      : rawStatus === 'research-ready' ? 38 : null,
    terminal: status === 'complete' || status === 'failed',
    existing: value.existing === true,
    productId,
    world: isRecord(value.world) ? value.world as unknown as ProductWorldLookup : null,
    message: typeof value.message === 'string' ? value.message : 'Trabajo recuperado del disco.',
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    completedAt: status === 'complete' || status === 'failed'
      ? typeof value.completedAt === 'string' ? value.completedAt : null
      : null,
    outputPath: typeof value.outputPath === 'string' ? value.outputPath : null,
    gates,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function filesUnder(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile()) {
      files.push(candidate);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const normalized = entry.name.toLowerCase();
    if (normalized === '.product-import-jobs' || normalized.includes('qa_rejected')) continue;
    files.push(...await filesUnder(candidate, depth + 1));
  }
  return files;
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function projectRootForManifest(manifestPath: string): string {
  const normalized = manifestPath.replaceAll('\\', '/').toLowerCase();
  for (const marker of [
    '/bibles/product-360/product-360.json',
    '/handoff/grok-r2v-reference-pack.json',
  ]) {
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) return manifestPath.slice(0, index);
  }
  return path.dirname(manifestPath);
}

async function referencedFileExists(
  reference: string,
  manifestPath: string,
  outputPath: string,
): Promise<boolean> {
  if (!reference) return false;
  const candidates = path.isAbsolute(reference)
    ? [reference]
    : [
        path.resolve(projectRootForManifest(manifestPath), reference),
        path.resolve(path.dirname(manifestPath), reference),
        path.resolve(outputPath, reference),
      ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return true;
  }
  return false;
}

async function analyzeCoverage(
  files: string[],
  outputPath: string,
): Promise<ProductImportGates['coverage360']> {
  const result = emptyGates().coverage360;
  const manifestPath = files.find((file) => path.basename(file).toLowerCase() === 'product-360.json');
  if (!manifestPath) return result;
  const manifest = await readJson(manifestPath);
  const rawViews = Array.isArray(manifest?.views) ? manifest.views : [];
  const usableAngles = new Set<number>();
  for (const rawView of rawViews) {
    if (!isRecord(rawView)) continue;
    const angle = typeof rawView.azimuth_deg === 'number' ? rawView.azimuth_deg : NaN;
    const reference = typeof rawView.path === 'string' ? rawView.path : '';
    if (
      !REQUIRED_ANGLES.includes(angle as typeof REQUIRED_ANGLES[number])
      || rawView.approved !== true
      || rawView.full_product !== true
      || rawView.asset_kind !== 'full_product_view'
      || !await referencedFileExists(reference, manifestPath, outputPath)
    ) continue;
    usableAngles.add(angle);
  }
  result.usableFullProductAngles = usableAngles.size;
  result.missingAngles = REQUIRED_ANGLES
    .filter((angle) => !usableAngles.has(angle))
    .map((angle) => ANGLE_LABELS.get(angle) ?? String(angle));
  result.ready = result.missingAngles.length === 0;
  return result;
}

async function analyzeReferencePack(
  files: string[],
  outputPath: string,
): Promise<ProductImportGates['videoReferences']> {
  const result = emptyGates().videoReferences;
  const manifestPath = files.find(
    (file) => path.basename(file).toLowerCase() === 'grok-r2v-reference-pack.json',
  );
  if (!manifestPath) return result;
  const manifest = await readJson(manifestPath);
  const rawReferences = Array.isArray(manifest?.references) ? manifest.references : [];
  const usable: Array<{ role: string; reference: string }> = [];
  const seen = new Set<string>();
  for (const rawReference of rawReferences) {
    if (!isRecord(rawReference)) continue;
    const role = typeof rawReference.role === 'string' ? rawReference.role : '';
    const reference = typeof rawReference.path === 'string'
      ? rawReference.path
      : typeof rawReference.file === 'string' ? rawReference.file : '';
    const identity = reference.replaceAll('\\', '/').toLowerCase();
    if (!role || !identity || seen.has(identity)) continue;
    if (!await referencedFileExists(reference, manifestPath, outputPath)) continue;
    seen.add(identity);
    usable.push({ role, reference });
  }
  result.total = usable.length;
  result.productBible = Math.min(1, usable.filter(({ role }) => role === 'product_bible').length);
  result.storyboard = Math.min(1, usable.filter(({ role }) => role === 'storyboard').length);
  result.fullProductAngles = usable.filter(({ role }) => (
    role === 'product_angle'
    || role.includes('full_product')
    || role.includes('full-product')
  )).length;
  const approval = isRecord(manifest?.approval) ? manifest.approval : {};
  result.ready = approval.approved === true
    && result.total === 7
    && result.productBible === 1
    && result.storyboard === 1
    && result.fullProductAngles === 5;
  return result;
}

function validVideoPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  return /\.(?:mp4|mov|webm)$/.test(normalized)
    && !/(?:qa_rejected|rejected|sample|partial|noaudio|source_reference)/.test(normalized);
}

function isFinalVideo(filePath: string): boolean {
  const filename = path.basename(filePath).toLowerCase();
  return validVideoPath(filePath)
    && /(?:^|[_-])15s(?:[_-]|\.)/.test(filename)
    && /(?:^|[_-])1080p(?:[_-]|\.)/.test(filename);
}

function isRawVideo(filePath: string): boolean {
  const filename = path.basename(filePath).toLowerCase();
  return validVideoPath(filePath)
    && /(?:^|[_-])15s(?:[_-]|\.)/.test(filename)
    && (/(?:^|[_-])720p(?:[_-]|\.)/.test(filename) || /(?:^|[_-])raw(?:[_-]|\.)/.test(filename));
}

async function setReconciledState(
  job: ProductImportJobInternal,
  status: InternalImportStatus,
  stage: ProductImportStage,
  progress: number,
  message: string,
  gates: ProductImportGates,
): Promise<void> {
  const before = JSON.stringify({
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    gates: job.gates,
    terminal: job.terminal,
  });
  job.status = status;
  job.stage = stage;
  job.progress = progress;
  job.message = message;
  job.gates = gates;
  job.terminal = status === 'complete' || status === 'failed';
  job.completedAt = job.terminal ? job.completedAt : null;
  const after = JSON.stringify({
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    gates: job.gates,
    terminal: job.terminal,
  });
  if (before !== after) {
    job.updatedAt = new Date().toISOString();
    await persistJob(job);
  }
}

async function reconcileJobFromDisk(job: ProductImportJobInternal): Promise<void> {
  if (executingJobIds.has(job.id) || job.status === 'failed') return;
  if (!job.outputPath && job.productId) {
    job.outputPath = path.join(path.dirname(persistenceRoot), `phu_out_${job.productId}`);
  }
  if (!job.outputPath) return;

  let outputStats;
  try {
    outputStats = await stat(job.outputPath);
  } catch {
    await failJob(job, new ImportFailure(
      'output_missing_after_restart',
      'El servidor se reiniciÃ³ antes de guardar la investigaciÃ³n. Vuelve a iniciar el producto.',
    ));
    return;
  }
  if (!outputStats.isDirectory()) return;

  const files = await filesUnder(job.outputPath);
  const gates: ProductImportGates = {
    coverage360: await analyzeCoverage(files, job.outputPath),
    videoReferences: await analyzeReferencePack(files, job.outputPath),
  };
  const gatesChanged = JSON.stringify(job.gates) !== JSON.stringify(gates);
  job.gates = gates;
  const finalVideo = files.find(isFinalVideo);
  if (finalVideo && job.productId) {
    if (job.status === 'complete') {
      if (gatesChanged) {
        job.updatedAt = new Date().toISOString();
        await persistJob(job);
      }
      return;
    }
    const world = await findProductWorldByProductId(job.productId, true);
    if (world) {
      await finishJob(job, world, job.existing);
      return;
    }
    await setReconciledState(
      job,
      'running',
      'publish-world',
      98,
      'El video final estÃ¡ listo; esperando que el catÃ¡logo publique el mundo.',
      gates,
    );
    return;
  }
  if (files.some(isRawVideo)) {
    await setReconciledState(
      job,
      'needs-input',
      'upscale-video',
      92,
      'El video 720p estÃ¡ listo. Falta preparar la entrega final 1080p.',
      gates,
    );
    return;
  }
  if (gates.videoReferences.ready) {
    await setReconciledState(
      job,
      'needs-input',
      'generate-grok-video',
      82,
      'Las siete referencias estÃ¡n aprobadas. La generaciÃ³n Grok debe ejecutarse con Codex.',
      gates,
    );
    return;
  }

  const hasBible = files.some((file) => path.basename(file).toLowerCase() === 'product-bible-visual.png');
  const hasStoryboard = files.some((file) => path.basename(file).toLowerCase() === 'storyboard-4x4.png');
  if (gates.coverage360.ready && hasBible && hasStoryboard) {
    await setReconciledState(
      job,
      'needs-input',
      'select-seven-references',
      72,
      'La Biblia y el storyboard existen. Falta aprobar el paquete exacto de siete referencias.',
      gates,
    );
  } else if (gates.coverage360.ready && hasBible) {
    await setReconciledState(
      job,
      'needs-input',
      'generate-storyboard',
      62,
      'La Product Bible estÃ¡ lista. El storyboard debe generarse con GPT Image 2 mediante Codex.',
      gates,
    );
  } else if (gates.coverage360.ready) {
    await setReconciledState(
      job,
      'needs-input',
      'generate-product-bible',
      52,
      'La cobertura 360Â° estÃ¡ aprobada. La Product Bible debe generarse con GPT Image 2 mediante Codex.',
      gates,
    );
  } else {
    await setReconciledState(
      job,
      'needs-input',
      'build-360-coverage',
      38,
      'La investigaciÃ³n estÃ¡ lista. Faltan vistas 360Â° que deben generarse con GPT Image 2 mediante Codex.',
      gates,
    );
  }
}

async function discoverLegacyHandoffs(flowRoot: string): Promise<void> {
  const outputRoot = path.join(flowRoot, 'out');
  let directories;
  try {
    directories = await readdir(outputRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const knownOutputs = new Set(
    [...jobs.values()].map((job) => job.outputPath?.toLowerCase()).filter(Boolean),
  );
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.name === '.product-import-jobs') continue;
    const outputPath = path.join(outputRoot, directory.name);
    if (knownOutputs.has(outputPath.toLowerCase())) continue;
    const markerPath = path.join(outputPath, 'phu_NEEDS_GPT_IMAGE_2.json');
    if (!await fileExists(markerPath)) continue;
    const marker = await readJson(markerPath);
    const match = directory.name.match(/phu_out_(\d{15,25})/i);
    const productId = typeof marker?.productId === 'string' && PRODUCT_ID_PATTERN.test(marker.productId)
      ? marker.productId
      : match?.[1] ?? null;
    if (!productId) continue;
    const markerStats = await stat(markerPath);
    const timestamp = markerStats.mtime.toISOString();
    const world = await findProductWorldByProductId(productId, true);
    const job: ProductImportJobInternal = {
      id: `recovered-${productId}-${Math.round(markerStats.mtimeMs).toString(36)}`,
      sourceUrl: `https://shop.tiktok.com/view/product/${productId}`,
      status: 'needs-input',
      stage: 'build-360-coverage',
      progress: 38,
      terminal: false,
      existing: Boolean(world),
      productId,
      world,
      message: 'Trabajo anterior recuperado desde sus artefactos locales.',
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      outputPath,
      gates: emptyGates(),
    };
    jobs.set(job.id, job);
    await persistJob(job);
    await reconcileJobFromDisk(job);
  }
}

async function initializeJobs(flowRoot: string): Promise<void> {
  const normalizedRoot = path.resolve(flowRoot);
  if (initializationPromise && initializedFlowRoot === normalizedRoot) {
    await initializationPromise;
    return;
  }
  initializedFlowRoot = normalizedRoot;
  persistenceRoot = path.join(normalizedRoot, 'out', '.product-import-jobs');
  initializationPromise = (async () => {
    await mkdir(persistenceRoot, { recursive: true });
    jobs.clear();
    activeJobId = null;
    const entries = await readdir(persistenceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value = await readJson(path.join(persistenceRoot, entry.name));
      const job = hydratedJob(value);
      if (job) jobs.set(job.id, job);
    }
    await discoverLegacyHandoffs(normalizedRoot);
    for (const job of jobs.values()) await reconcileJobFromDisk(job);
    const active = [...jobs.values()]
      .filter((job) => !job.terminal)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    activeJobId = active?.id ?? null;
  })();
  await initializationPromise;
}

function validateTikTokUrl(value: unknown): URL {
  if (typeof value !== 'string') {
    throw new ImportFailure('invalid_source_url', 'Ingresa una URL HTTPS válida de TikTok.');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new ImportFailure('invalid_source_url', 'Ingresa una URL HTTPS válida de TikTok.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ImportFailure('invalid_source_url', 'Ingresa una URL HTTPS válida de TikTok.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowedHostname = hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
  if (
    parsed.protocol !== 'https:'
    || !allowedHostname
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== '443')
  ) {
    throw new ImportFailure(
      'invalid_source_url',
      'Solo se aceptan enlaces HTTPS alojados en TikTok.',
    );
  }

  parsed.hash = '';
  return parsed;
}

function productIdFromText(value: string, source: 'url' | 'body'): string | null {
  const patterns = source === 'url'
    ? [
        /\/(\d{15,25})(?:[/?#]|$)/,
        /[?&](?:product_id|productId)=(\d{15,25})(?:&|$)/i,
      ]
    : [
        /["']?product_id["']?\s*[:=]\s*["']?(\d{15,25})/i,
        /["']?productId["']?\s*[:=]\s*["']?(\d{15,25})/i,
        /\/(?:pdp|product)\/[^"'<>\s]*?(\d{15,25})(?:[/?#"'<>\s]|$)/i,
      ];
  for (const pattern of patterns) {
    const candidate = value.match(pattern)?.[1];
    if (candidate && PRODUCT_ID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

async function readResponseTextLimited(response: globalThis.Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESOLUTION_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveTikTokProductId(sourceUrl: string): Promise<string> {
  let current = validateTikTokUrl(sourceUrl);
  const directId = productIdFromText(current.toString(), 'url');
  if (directId) return directId;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESOLUTION_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 ProductWorldResearchImporter/1.0',
        },
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new ImportFailure('resolution_failed', 'TikTok no devolvió un destino válido.');
        }
        current = validateTikTokUrl(new URL(location, current).toString());
        const redirectId = productIdFromText(current.toString(), 'url');
        if (redirectId) return redirectId;
        continue;
      }

      if (!response.ok) {
        throw new ImportFailure(
          'resolution_failed',
          'TikTok no permitió resolver ese enlace en este momento.',
          `HTTP ${response.status}`,
        );
      }

      const finalId = productIdFromText(current.toString(), 'url');
      if (finalId) return finalId;
      const body = await readResponseTextLimited(response);
      const bodyId = productIdFromText(body, 'body');
      if (bodyId) return bodyId;
      break;
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ImportFailure('resolution_timeout', 'TikTok tardó demasiado en resolver el enlace.');
      }
      throw new ImportFailure(
        'resolution_failed',
        'No se pudo resolver el producto desde ese enlace de TikTok.',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ImportFailure(
    'product_id_not_found',
    'No se encontró un identificador de producto en el enlace de TikTok.',
  );
}

function researchOnlyEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    KEEP_OPEN: '0',
    PHU_LEAVE_BROWSER: '0',
    PYTHONUTF8: '1',
  };
  for (const secretName of [
    'XAI_API_KEY',
    'GROK_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
  ]) {
    delete environment[secretName];
  }
  return environment;
}

function appendTail(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-8_192);
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { shell: false, stdio: 'ignore', windowsHide: true },
      );
      killer.once('error', () => resolve());
      killer.once('close', () => resolve());
    });
    return;
  }
  child.kill('SIGTERM');
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: researchOnlyEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let outputTail = '';
    let settled = false;
    let timedOut = false;
    let forceSettleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      callback();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      outputTail = appendTail(outputTail, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      outputTail = appendTail(outputTail, chunk);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      if (timedOut) {
        finish(() => reject(new ImportFailure('process_timeout', 'La extracción excedió el tiempo permitido.')));
        return;
      }
      finish(() => resolve({ code: code ?? -1, outputTail }));
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
      forceSettleTimer = setTimeout(() => {
        finish(() => reject(new ImportFailure('process_timeout', 'La extracción excedió el tiempo permitido.')));
      }, 5_000);
    }, timeoutMs);
  });
}

async function checkedFlowRoot(configuredRoot: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(configuredRoot));
  } catch {
    throw new ImportFailure('flow_unavailable', 'El extractor local no está disponible.');
  }
  const rootStats = await stat(resolved);
  if (!rootStats.isDirectory()) {
    throw new ImportFailure('flow_unavailable', 'El extractor local no está disponible.');
  }
  for (const filename of ['phu_run_extract.mjs', 'phu_postprocess.py']) {
    const candidate = path.join(resolved, filename);
    try {
      await access(candidate, constants.R_OK);
      const candidateStats = await stat(candidate);
      if (!candidateStats.isFile()) throw new Error('not a file');
    } catch {
      throw new ImportFailure('flow_unavailable', 'El extractor local no está completo.');
    }
  }
  return resolved;
}

async function outputDirectoryFor(
  flowRoot: string,
  productId: string,
  jobId: string,
): Promise<string> {
  const outputRoot = path.join(flowRoot, 'out');
  const canonical = path.join(outputRoot, `phu_out_${productId}`);
  try {
    await access(canonical);
    return path.join(
      outputRoot,
      `phu_out_${productId}_import_${Date.now()}_${jobId.slice(0, 8)}`,
    );
  } catch {
    return canonical;
  }
}

async function writeGptImage2Handoff(outputPath: string, productId: string): Promise<void> {
  const payload = {
    schemaVersion: '1.0',
    status: 'needs_gpt_image_2',
    productId,
    source: 'research-only-import',
    generationExecuted: false,
    coverage360: {
      required: true,
      sectors: [
        { degrees: 0, label: 'front' },
        { degrees: 45, label: 'front-left' },
        { degrees: 90, label: 'left-profile' },
        { degrees: 135, label: 'rear-left' },
        { degrees: 180, label: 'rear' },
        { degrees: 225, label: 'rear-right' },
        { degrees: 270, label: 'right-profile' },
        { degrees: 315, label: 'front-right' },
      ],
      fullProductRequired: true,
      background: 'white',
      provenanceRequired: true,
    },
    grokReferenceContract: {
      model: 'grok-imagine-video-1.5',
      mode: 'reference-to-video',
      durationSeconds: 15,
      resolution: '720p',
      aspectRatio: '9:16',
      exactCount: 7,
      order: [
        'product-bible',
        'storyboard',
        'full-product-angle-1',
        'full-product-angle-2',
        'full-product-angle-3',
        'full-product-angle-4',
        'full-product-angle-5',
      ],
      uniqueImages: true,
      cropsForbiddenForAngleSlots: true,
    },
  };
  await writeFile(
    path.join(outputPath, 'phu_NEEDS_GPT_IMAGE_2.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

function isLocalRequest(request: Request): boolean {
  const remoteAddress = request.socket.remoteAddress ?? '';
  const localSocket = remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
  if (!localSocket) return false;

  const hostname = request.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;

  const origin = request.get('origin');
  if (!origin) return true;
  try {
    const originHostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(originHostname);
  } catch {
    return false;
  }
}

async function executeImport(
  jobId: string,
  configuredFlowRoot: string,
  pythonExecutable: string,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  executingJobIds.add(job.id);
  try {
    job.startedAt = new Date().toISOString();
    await updateJob(job, 'running', 'resolve-source', 5, 'Resolviendo el producto de TikTok de forma segura.');
    const productId = await resolveTikTokProductId(job.sourceUrl);
    job.productId = productId;

    const flowRoot = await checkedFlowRoot(configuredFlowRoot);
    const existingWorld = await findProductWorldByProductId(productId, true);
    const canonicalOutput = path.join(flowRoot, 'out', `phu_out_${productId}`);
    if (existingWorld && await stat(canonicalOutput).then((value) => value.isDirectory()).catch(() => false)) {
      job.existing = true;
      job.world = existingWorld;
      job.outputPath = canonicalOutput;
      await writeGptImage2Handoff(canonicalOutput, productId);
      await updateJob(
        job,
        'running',
        'research-ready',
        35,
        'El producto ya existía; se reutilizó su investigación sin duplicarla.',
      );
      executingJobIds.delete(job.id);
      await reconcileJobFromDisk(job);
      return;
    }

    const outputPath = await outputDirectoryFor(flowRoot, productId, job.id);
    job.outputPath = outputPath;
    job.existing = Boolean(existingWorld);
    job.world = existingWorld;

    await updateJob(
      job,
      'running',
      'extract-product',
      12,
      'Extrayendo datos e imágenes originales desde TikTok Shop.',
    );
    const extraction = await runProcess(
      process.execPath,
      [path.join(flowRoot, 'phu_run_extract.mjs'), productId, outputPath],
      flowRoot,
      EXTRACT_TIMEOUT_MS,
    );
    if (extraction.code !== 0) {
      throw new ImportFailure(
        'extraction_failed',
        extraction.code === 2
          ? 'TikTok solicitó una verificación manual; abre Chrome y vuelve a intentarlo.'
          : 'No se pudo extraer el producto desde TikTok.',
        `exit=${extraction.code}\n${extraction.outputTail}`,
      );
    }

    await updateJob(
      job,
      'running',
      'clean-images',
      24,
      'Organizando la investigación y descargando la galería del producto.',
    );
    const postprocess = await runProcess(
      pythonExecutable,
      [path.join(flowRoot, 'phu_postprocess.py'), outputPath],
      flowRoot,
      POSTPROCESS_TIMEOUT_MS,
    );
    if (postprocess.code !== 0) {
      throw new ImportFailure(
        'postprocess_failed',
        'La extracción terminó, pero no se pudo organizar la investigación.',
        `exit=${postprocess.code}\n${postprocess.outputTail}`,
      );
    }

    await writeGptImage2Handoff(outputPath, productId);

    const world = await findProductWorldByProductId(productId, true);
    if (!world) {
      throw new ImportFailure(
        'world_not_registered',
        'La investigación terminó, pero el producto no pudo registrarse en el catálogo.',
      );
    }
    job.world = world;
    await updateJob(
      job,
      'running',
      'research-ready',
      35,
      'La investigación inicial ya está publicada; preparando la cobertura 360°.',
    );
    executingJobIds.delete(job.id);
    await reconcileJobFromDisk(job);
  } catch (error) {
    await failJob(job, error);
  } finally {
    executingJobIds.delete(job.id);
    pruneJobs();
  }
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

export function createProductImportJobsRouter(
  options: ProductImportJobsOptions = {},
): Router {
  const router = Router();
  const configuredFlowRoot = options.flowRoot
    ?? process.env.PRODUCT_IMPORT_FLOW_ROOT
    ?? DEFAULT_FLOW_ROOT;
  const pythonExecutable = options.pythonExecutable
    ?? process.env.PRODUCT_IMPORT_PYTHON
    ?? 'python';
  const ready = initializeJobs(configuredFlowRoot);

  router.use(json({ limit: MAX_BODY_BYTES, strict: true, type: 'application/json' }));
  const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    const bodyError = error as { status?: number; type?: string };
    if (bodyError.status === 413 || bodyError.type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'payload_too_large', message: 'La solicitud supera el límite de 16 KB.' },
      });
      return;
    }
    if (bodyError.status === 400 && error instanceof SyntaxError) {
      response.status(400).json({
        error: { code: 'invalid_json', message: 'El cuerpo JSON no es válido.' },
      });
      return;
    }
    next(error);
  };
  router.use(jsonErrorHandler);
  router.use('/imports', (request, response, next) => {
    if (isLocalRequest(request)) {
      next();
      return;
    }
    response.status(403).json({
      error: {
        code: 'local_request_required',
        message: 'La importación de productos solo está disponible desde este equipo.',
      },
    });
  });

  router.post('/imports', asyncHandler(async (request, response) => {
    await ready;
    if (!request.is('application/json')) {
      response.status(415).json({
        error: { code: 'unsupported_media_type', message: 'Usa Content-Type: application/json.' },
      });
      return;
    }
    if (!isRecord(request.body)) {
      response.status(400).json({
        error: { code: 'invalid_request', message: 'La solicitud debe contener sourceUrl.' },
      });
      return;
    }

    let sourceUrl: string;
    try {
      sourceUrl = validateTikTokUrl(request.body.sourceUrl).toString();
    } catch (error) {
      const failure = error instanceof ImportFailure
        ? error
        : new ImportFailure('invalid_source_url', 'Ingresa una URL HTTPS válida de TikTok.');
      response.status(400).json({ error: { code: failure.code, message: failure.message } });
      return;
    }

    const activeJob = activeJobId ? jobs.get(activeJobId) ?? null : null;
    if (activeJob) await reconcileJobFromDisk(activeJob);
    if (activeJob && !activeJob.terminal) {
      response.status(409).json({
        error: {
          code: 'import_in_progress',
          message: 'Ya hay una extracción en curso. Espera a que termine antes de agregar otro producto.',
        },
        job: publicJob(activeJob),
      });
      return;
    }

    const now = new Date().toISOString();
    const job: ProductImportJobInternal = {
      id: randomBytes(18).toString('base64url'),
      sourceUrl,
      status: 'queued',
      stage: 'resolve-source',
      progress: 0,
      terminal: false,
      existing: false,
      productId: null,
      world: null,
      message: 'La extracción está en cola.',
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      outputPath: null,
      gates: emptyGates(),
    };
    jobs.set(job.id, job);
    activeJobId = job.id;
    await persistJob(job);
    setImmediate(() => {
      void executeImport(job.id, configuredFlowRoot, pythonExecutable);
    });

    response.status(202).json({ job: publicJob(job) });
  }));

  router.get('/imports/active', asyncHandler(async (_request, response) => {
    await ready;
    const job = activeJobId ? jobs.get(activeJobId) ?? null : null;
    if (job) await reconcileJobFromDisk(job);
    if (job?.terminal && activeJobId === job.id) activeJobId = null;
    response.json({ job: job && !job.terminal ? publicJob(job) : null });
  }));

  router.get('/imports/latest', asyncHandler(async (_request, response) => {
    await ready;
    const job = [...jobs.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
    if (job) await reconcileJobFromDisk(job);
    response.json({ job: job ? publicJob(job) : null });
  }));

  router.get('/imports/:jobId', asyncHandler(async (request, response) => {
    await ready;
    const job = jobs.get(request.params.jobId);
    if (!job) {
      response.status(404).json({
        error: { code: 'import_not_found', message: 'La extracción solicitada no existe.' },
      });
      return;
    }
    await reconcileJobFromDisk(job);
    if (job.terminal && activeJobId === job.id) activeJobId = null;
    response.json({ job: publicJob(job) });
  }));

  return router;
}
