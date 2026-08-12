import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const PRODUCTION_DIRECTORY = 'phu_production_15s';
const MAX_DEPTH = 3;
const MAX_FILES = 32;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_QA_MARKER_BYTES = 64 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REJECTED_VIDEO_DIRECTORY = path.join('phu_video', 'qa_rejected_handoff_v1');
const ALLOWED_REJECTED_VIDEO_FILES = [
  'phu_product_hold_handoff_15s_720p_raw.mp4',
  'phu_product_hold_handoff_15s_1080p.mp4',
] as const;
const MAX_REJECTED_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_REJECTED_VIDEO_TOTAL_BYTES = 128 * 1024 * 1024;

// This is deliberately an exact, reviewable publication list. In particular,
// `sources`, provider responses, edit scratch space and arbitrary future files
// are not exposed merely because they live under phu_production_15s.
const ALLOWED_RELATIVE_FILES = new Set([
  'direction-sheet.png',
  'environment-bible.md',
  'first-frame.png',
  'project_manifest.json',
  'shot-plan-16.json',
  'bibles/character_bible.json',
  'bibles/location_bible.json',
  'bibles/product-bible-visual.png',
  'bibles/product_bible.json',
  'bibles/style_bible.json',
  'bibles/product-360/product-360.json',
  'bibles/product-360/view-000.png',
  'bibles/product-360/view-045.png',
  'bibles/product-360/view-090.png',
  'bibles/product-360/view-135.png',
  'bibles/product-360/view-180.png',
  'bibles/product-360/view-225.png',
  'bibles/product-360/view-270.png',
  'bibles/product-360/view-315.png',
  'handoff/grok-r2v-reference-pack.json',
  'prompts/grok-r2v-prompt.txt',
  'storyboard/prompt-sheet.txt',
  'storyboard/shot_manifest.json',
  'storyboard/storyboard-4x4.png',
  'storyboard/storyboard.json',
  'storyboard/validation-report.md',
]);

const ALLOWED_RELATIVE_DIRECTORIES = new Set(
  [...ALLOWED_RELATIVE_FILES].flatMap((filePath) => {
    const directories: string[] = [];
    let current = path.posix.dirname(filePath);
    while (current !== '.') {
      directories.push(current);
      current = path.posix.dirname(current);
    }
    return directories;
  }),
);

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

type JsonRecord = Record<string, unknown>;

export interface PhuVideoQaPolicy {
  required: boolean;
  approvedArtifact: string | null;
  approvedSha256: string | null;
  rejectedArtifacts: ReadonlySet<string>;
}

export type PhuVideoQaStatus = 'not-required' | 'approved' | 'pending' | 'rejected';

const digestCache = new Map<string, string>();

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function normalizeQaArtifact(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('\\', '/');
  const videoDirectoryIndex = normalized.toLowerCase().lastIndexOf('phu_video/');
  return videoDirectoryIndex >= 0
    ? normalized.slice(videoDirectoryIndex).toLowerCase()
    : null;
}

/** Files needed by the pipeline but unsafe or unnecessary in the public inspector. */
export function isPrivatePhuProductionArtifact(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  return [
    'phu_done.txt',
    'phu_page.html',
    'phu_raw.json',
    'phu_video_qa_pass.json',
    'phu_video_qa_fail.json',
    'phu_production_15s/qa/qa_report.json',
  ].includes(normalized)
    || /^phu_video\/[^/]+_(?:job_meta|provider_response|request)\.json$/.test(normalized);
}

async function readQaMarker(productRoot: string, filename: string): Promise<JsonRecord> {
  const candidate = path.resolve(productRoot, filename);
  try {
    const linkStats = await lstat(candidate);
    if (!linkStats.isFile() || linkStats.isSymbolicLink() || linkStats.size > MAX_QA_MARKER_BYTES) {
      return {};
    }
    const resolvedRoot = await realpath(productRoot);
    const resolved = await realpath(candidate);
    if (!isPathInside(resolvedRoot, resolved)) return {};
    return record(JSON.parse(await readFile(resolved, 'utf8')));
  } catch {
    return {};
  }
}

async function productionDirectoryExists(productRoot: string): Promise<boolean> {
  const candidate = path.resolve(productRoot, PRODUCTION_DIRECTORY);
  try {
    const linkStats = await lstat(candidate);
    return linkStats.isDirectory() && !linkStats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function sha256File(filePath: string, size: number, updatedAtMs: number): Promise<string> {
  const cacheKey = `${filePath.toLowerCase()}:${size}:${updatedAtMs}`;
  const cached = digestCache.get(cacheKey);
  if (cached) return cached;

  const digest = await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
  digestCache.set(cacheKey, digest);
  return digest;
}

/**
 * New `phu_production_15s` runs require an explicit, matching QA marker before
 * a filename may become the canonical final video. A FAIL marker wins over a
 * stale PASS marker for the same artifact.
 */
export async function loadPhuVideoQaPolicy(productRoot: string): Promise<PhuVideoQaPolicy> {
  const required = await productionDirectoryExists(productRoot);
  if (!required) {
    return {
      required: false,
      approvedArtifact: null,
      approvedSha256: null,
      rejectedArtifacts: new Set<string>(),
    };
  }

  const [passMarker, failMarker] = await Promise.all([
    readQaMarker(productRoot, 'phu_VIDEO_QA_PASS.json'),
    readQaMarker(productRoot, 'phu_VIDEO_QA_FAIL.json'),
  ]);
  const passStatus = typeof passMarker.status === 'string' ? passMarker.status.toLowerCase() : '';
  const failStatus = typeof failMarker.status === 'string' ? failMarker.status.toLowerCase() : '';
  const approvedArtifact = passMarker.approved === true && ['passed', 'approved'].includes(passStatus)
    ? normalizeQaArtifact(passMarker.artifact)
    : null;
  const passDigest = typeof passMarker.artifact_sha256 === 'string'
    && SHA256_PATTERN.test(passMarker.artifact_sha256)
    ? passMarker.artifact_sha256.toLowerCase()
    : null;
  const rejectedArtifact = (failMarker.approved === false || ['rejected', 'failed'].includes(failStatus))
    ? normalizeQaArtifact(failMarker.artifact)
    : null;
  const rejectedArtifacts = new Set<string>();
  if (rejectedArtifact) rejectedArtifacts.add(rejectedArtifact);

  return {
    required,
    approvedArtifact,
    approvedSha256: approvedArtifact ? passDigest : null,
    rejectedArtifacts,
  };
}

export async function evaluatePhuVideoQa(
  policy: PhuVideoQaPolicy,
  relativePath: string,
  absolutePath: string,
  size: number,
  updatedAtMs: number,
): Promise<PhuVideoQaStatus> {
  if (!policy.required) return 'not-required';
  const normalizedPath = relativePath.replaceAll('\\', '/').toLowerCase();
  if (policy.rejectedArtifacts.has(normalizedPath)) return 'rejected';
  if (
    policy.approvedArtifact !== normalizedPath
    || !policy.approvedSha256
  ) {
    return 'pending';
  }
  const digest = await sha256File(absolutePath, size, updatedAtMs);
  return digest === policy.approvedSha256 ? 'approved' : 'pending';
}

/**
 * Recursively discovers only approved production-delivery files.
 * The walk is depth-, count- and byte-bounded and never follows symlinks.
 */
export async function listAllowedPhuProductionArtifacts(productRoot: string): Promise<string[]> {
  const configuredRoot = path.resolve(productRoot, PRODUCTION_DIRECTORY);
  let productionRoot: string;
  try {
    const rootLinkStats = await lstat(configuredRoot);
    if (!rootLinkStats.isDirectory() || rootLinkStats.isSymbolicLink()) return [];
    productionRoot = await realpath(configuredRoot);
  } catch {
    return [];
  }

  const files: string[] = [];
  let totalBytes = 0;

  const visit = async (
    directory: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));

    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return;
      if (entry.isSymbolicLink()) continue;

      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const candidate = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || !ALLOWED_RELATIVE_DIRECTORIES.has(relativePath)) continue;
        try {
          const linkStats = await lstat(candidate);
          if (!linkStats.isDirectory() || linkStats.isSymbolicLink()) continue;
          const resolved = await realpath(candidate);
          if (!isPathInside(productionRoot, resolved)) continue;
          await visit(resolved, relativePath, depth + 1);
        } catch {
          // A running production job may replace an entry while it is scanned.
        }
        continue;
      }

      if (!entry.isFile() || !ALLOWED_RELATIVE_FILES.has(relativePath)) continue;
      try {
        const linkStats = await lstat(candidate);
        if (!linkStats.isFile() || linkStats.isSymbolicLink()) continue;
        const resolved = await realpath(candidate);
        if (!isPathInside(productionRoot, resolved)) continue;
        const fileStats = await stat(resolved);
        if (
          !fileStats.isFile()
          || fileStats.size <= 0
          || fileStats.size > MAX_FILE_BYTES
          || totalBytes + fileStats.size > MAX_TOTAL_BYTES
        ) {
          continue;
        }
        files.push(resolved);
        totalBytes += fileStats.size;
      } catch {
        // A running production job may replace an entry while it is scanned.
      }
    }
  };

  await visit(productionRoot, '', 0);
  return files;
}

/**
 * Publishes only the two paid v1 attempts retained for QA audit. The duplicate
 * copy and request/provider metadata in the same folder are intentionally not
 * discoverable.
 */
export async function listAllowedPhuRejectedVideoArtifacts(productRoot: string): Promise<string[]> {
  const configuredDirectory = path.resolve(productRoot, REJECTED_VIDEO_DIRECTORY);
  let rejectedDirectory: string;
  try {
    const linkStats = await lstat(configuredDirectory);
    if (!linkStats.isDirectory() || linkStats.isSymbolicLink()) return [];
    rejectedDirectory = await realpath(configuredDirectory);
  } catch {
    return [];
  }

  const files: string[] = [];
  let totalBytes = 0;
  for (const filename of ALLOWED_REJECTED_VIDEO_FILES) {
    const candidate = path.resolve(rejectedDirectory, filename);
    try {
      const linkStats = await lstat(candidate);
      if (!linkStats.isFile() || linkStats.isSymbolicLink()) continue;
      const resolved = await realpath(candidate);
      if (!isPathInside(rejectedDirectory, resolved)) continue;
      const fileStats = await stat(resolved);
      if (
        !fileStats.isFile()
        || fileStats.size <= 0
        || fileStats.size > MAX_REJECTED_VIDEO_BYTES
        || totalBytes + fileStats.size > MAX_REJECTED_VIDEO_TOTAL_BYTES
      ) {
        continue;
      }
      files.push(resolved);
      totalBytes += fileStats.size;
    } catch {
      // The audit directory may be populated atomically while the app scans it.
    }
  }
  return files;
}
