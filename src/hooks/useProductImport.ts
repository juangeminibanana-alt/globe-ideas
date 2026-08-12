import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProductImportJob,
  ProductImportJobResponse,
  ProductImportStage,
  ProductImportStatus,
} from '../types/fastTrack';

const IMPORTS_ENDPOINT = '/api/product-worlds/imports';
const ACTIVE_IMPORT_SESSION_KEY = 'product-world-active-import-id';
const ACTIVE_POLL_INTERVAL_MS = 2_000;
const WAITING_POLL_INTERVAL_MS = 6_000;
const RECONNECT_POLL_INTERVAL_MS = 5_000;
let idempotencySequence = 0;

const TERMINAL_STATUSES = new Set<ProductImportStatus>(['failed', 'complete']);
const IMPORT_STAGES = new Set<ProductImportStage>([
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
const CATALOG_READY_STAGES = new Set<ProductImportStage>([
  'research-ready',
  'build-360-coverage',
  'generate-product-bible',
  'generate-storyboard',
  'select-seven-references',
  'generate-grok-video',
  'upscale-video',
  'publish-world',
]);

type UnknownRecord = Record<string, unknown>;

interface UseProductImportOptions {
  onCatalogReady?: (job: ProductImportJob) => void | Promise<void>;
}

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStatus(value: unknown): ProductImportStatus {
  const status = text(value).trim().toLowerCase().replaceAll('_', '-');
  if (status === 'complete' || status === 'completed' || status === 'success') return 'complete';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'blocked' || status === 'blocked-watermark') return 'blocked';
  if (status === 'needs-input' || status === 'needs-background' || status === 'awaiting-input') return 'needs-input';
  if (status === 'research-ready') return 'running';
  if (status === 'queued' || status === 'pending') return 'queued';
  return 'running';
}

function normalizeStage(value: unknown): ProductImportStage {
  const stage = text(value).trim().toLowerCase().replaceAll('_', '-');
  if (IMPORT_STAGES.has(stage as ProductImportStage)) return stage as ProductImportStage;

  const aliases: Record<string, ProductImportStage> = {
    resolving: 'resolve-source',
    'resolving-url': 'resolve-source',
    extracting: 'extract-product',
    discovered: 'extract-product',
    postprocessing: 'clean-images',
    'watermark-check': 'clean-images',
    'clean-watermarks': 'clean-images',
    'collecting-360': 'build-360-coverage',
    'building-360': 'build-360-coverage',
    'building-bible': 'generate-product-bible',
    'generating-bible': 'generate-product-bible',
    'building-storyboard': 'generate-storyboard',
    'selecting-references': 'select-seven-references',
    'generating-video': 'generate-grok-video',
    'upscale-1080': 'upscale-video',
    'publishing-world': 'publish-world',
  };
  return aliases[stage] ?? 'extract-product';
}

function normalizeJob(payload: unknown): ProductImportJob {
  const envelope = record(payload);
  const source = record(envelope.job ?? payload) as UnknownRecord;
  const id = text(source.id, text(source.jobId)).trim();
  if (!id) throw new Error('El servidor no devolvi\u00f3 un identificador de trabajo v\u00e1lido.');

  const gates = record(source.gates);
  const world = record(source.world);
  const coverage = record(gates.coverage360);
  const references = record(gates.videoReferences);
  const error = record(source.error);
  const rawProgress = finiteNumber(source.progress);
  const progress = rawProgress === undefined ? null : Math.min(100, Math.max(0, rawProgress));

  return {
    id,
    sourceUrl: text(source.sourceUrl, text(source.source_url)),
    status: normalizeStatus(source.status),
    stage: normalizeStage(source.stage ?? source.phase ?? source.status),
    progress,
    message: text(source.message) || undefined,
    productId: text(source.productId, text(source.product_id, text(world.productId, text(world.id)))) || undefined,
    manifestUrl: text(source.manifestUrl, text(source.manifest_url, text(world.manifestUrl))) || undefined,
    terminal: source.terminal === true,
    mergedIntoExistingWorld: source.mergedIntoExistingWorld === true
      || source.merged_into_existing_world === true
      || source.existing === true,
    createdAt: text(source.createdAt, text(source.created_at)) || undefined,
    updatedAt: text(source.updatedAt, text(source.updated_at)) || undefined,
    gates: Object.keys(gates).length > 0
      ? {
          coverage360: Object.keys(coverage).length > 0
            ? {
                ready: coverage.ready === true,
                usableFullProductAngles: finiteNumber(coverage.usableFullProductAngles) ?? 0,
                requiredAngles: finiteNumber(coverage.requiredAngles) ?? 8,
                missingAngles: Array.isArray(coverage.missingAngles)
                  ? coverage.missingAngles.filter((item): item is string => typeof item === 'string')
                  : undefined,
              }
            : undefined,
          videoReferences: Object.keys(references).length > 0
            ? {
                ready: references.ready === true,
                total: finiteNumber(references.total) ?? 0,
                productBible: finiteNumber(references.productBible) ?? 0,
                storyboard: finiteNumber(references.storyboard) ?? 0,
                fullProductAngles: finiteNumber(references.fullProductAngles) ?? 0,
              }
            : undefined,
        }
      : undefined,
    error: Object.keys(error).length > 0
      ? {
          code: text(error.code, 'import_failed'),
          message: text(error.message, 'La extracci\u00f3n no pudo continuar.'),
          retriable: error.retriable === true,
        }
      : undefined,
  };
}

async function responseError(response: Response, payload: unknown): Promise<Error> {
  const source = record(payload);
  const error = record(source.error);
  const message = text(error.message, text(source.message))
    || `No se pudo iniciar la extracci\u00f3n (${response.status}).`;
  return new Error(message);
}

function readStoredJobId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_IMPORT_SESSION_KEY);
  } catch {
    return null;
  }
}

function storeJobId(jobId: string | null): void {
  try {
    if (jobId) window.sessionStorage.setItem(ACTIVE_IMPORT_SESSION_KEY, jobId);
    else window.sessionStorage.removeItem(ACTIVE_IMPORT_SESSION_KEY);
  } catch {
    // The import still works when storage is disabled; only reload recovery is unavailable.
  }
}

function shouldContinuePolling(job: ProductImportJob): boolean {
  return job.terminal !== true && !TERMINAL_STATUSES.has(job.status);
}

function createIdempotencyKey(): string {
  idempotencySequence += 1;
  return globalThis.crypto?.randomUUID?.()
    ?? `product-import-${Date.now().toString(36)}-${idempotencySequence.toString(36)}`;
}

function pollDelay(job: ProductImportJob): number {
  return job.status === 'needs-input' ? WAITING_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
}

export function validateTikTokUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Pega un enlace completo de TikTok, por ejemplo https://vt.tiktok.com/...');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const isTikTokHost = hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
  if (url.protocol !== 'https:' || !isTikTokHost || url.username || url.password) {
    throw new Error('El enlace debe ser una URL HTTPS de TikTok.');
  }
  return url.toString();
}

export function useProductImport({ onCatalogReady }: UseProductImportOptions = {}) {
  const initialJobIdRef = useRef<string | null>(readStoredJobId());
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobIdRef.current);
  const [job, setJob] = useState<ProductImportJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(Boolean(initialJobIdRef.current));
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  const submitControllerRef = useRef<AbortController | null>(null);
  const onCatalogReadyRef = useRef(onCatalogReady);
  const catalogSignalsRef = useRef(new Set<string>());

  useEffect(() => {
    if (initialJobIdRef.current) return undefined;

    const controller = new AbortController();
    void fetch(`${IMPORTS_ENDPOINT}/active`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json().catch(() => null) as ProductImportJobResponse | unknown;
      const activePayload = record(record(payload).job);
      if (!Object.keys(activePayload).length) return;
      const activeJob = normalizeJob(payload);
      storeJobId(activeJob.id);
      setActiveJobId(activeJob.id);
      setJob(activeJob);
    }).catch((caught) => {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError('No se pudo comprobar si existe una extracción activa.');
      }
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    onCatalogReadyRef.current = onCatalogReady;
  }, [onCatalogReady]);

  const notifyCatalogReady = useCallback((nextJob: ProductImportJob) => {
    const signal = nextJob.status === 'complete'
      ? 'complete'
      : CATALOG_READY_STAGES.has(nextJob.stage)
        ? 'research-ready'
        : null;
    if (!signal || !nextJob.productId) return;

    const signalKey = `${nextJob.id}:${signal}`;
    if (catalogSignalsRef.current.has(signalKey)) return;
    catalogSignalsRef.current.add(signalKey);
    void Promise.resolve(onCatalogReadyRef.current?.(nextJob)).catch(() => {
      setError('El producto est\u00e1 listo, pero el cat\u00e1logo no pudo actualizarse autom\u00e1ticamente.');
    });
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      setIsRestoring(false);
      setIsReconnecting(false);
      return undefined;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        const response = await fetch(`${IMPORTS_ENDPOINT}/${encodeURIComponent(activeJobId)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as ProductImportJobResponse | unknown;
        if (response.status === 404) {
          const recoveryResponse = await fetch(`${IMPORTS_ENDPOINT}/latest`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const recoveryPayload = await recoveryResponse.json().catch(() => null) as ProductImportJobResponse | unknown;
          const recoveredSource = record(record(recoveryPayload).job);
          if (recoveryResponse.ok && Object.keys(recoveredSource).length > 0) {
            const recoveredJob = normalizeJob(recoveryPayload);
            storeJobId(recoveredJob.id);
            setActiveJobId(recoveredJob.id);
            setJob(recoveredJob);
            setIsRestoring(false);
            setIsReconnecting(false);
            setError(null);
            notifyCatalogReady(recoveredJob);
            return;
          }
          storeJobId(null);
          setActiveJobId(null);
          setJob(null);
          setError('El trabajo guardado ya no est\u00e1 disponible. Puedes iniciar otro producto.');
          return;
        }
        if (!response.ok) throw await responseError(response, payload);

        const nextJob = normalizeJob(payload);
        if (cancelled) return;
        setJob(nextJob);
        setIsRestoring(false);
        setIsReconnecting(false);
        setError(null);
        notifyCatalogReady(nextJob);
        if (shouldContinuePolling(nextJob)) schedule(pollDelay(nextJob));
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setIsRestoring(false);
        setIsReconnecting(true);
        setError(caught instanceof Error ? caught.message : 'Se perdi\u00f3 la conexi\u00f3n con la extracci\u00f3n.');
        schedule(RECONNECT_POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeJobId, notifyCatalogReady, pollVersion]);

  useEffect(() => () => submitControllerRef.current?.abort(), []);

  const startImport = useCallback(async (sourceUrl: string) => {
    const normalizedUrl = validateTikTokUrl(sourceUrl);
    submitControllerRef.current?.abort();
    const controller = new AbortController();
    submitControllerRef.current = controller;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(IMPORTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({ sourceUrl: normalizedUrl }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as ProductImportJobResponse | unknown;
      const source = record(payload);
      const hasReusableJob = response.status === 409 && Object.keys(record(source.job)).length > 0;
      if (!response.ok && !hasReusableJob) throw await responseError(response, payload);

      const nextJob = normalizeJob(payload);
      storeJobId(nextJob.id);
      setActiveJobId(nextJob.id);
      setJob(nextJob);
      setIsReconnecting(false);
      notifyCatalogReady(nextJob);
      return nextJob;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return null;
      const message = caught instanceof Error ? caught.message : 'No se pudo iniciar la extracci\u00f3n.';
      setError(message);
      throw caught;
    } finally {
      if (!controller.signal.aborted) setIsSubmitting(false);
    }
  }, [notifyCatalogReady]);

  const reset = useCallback(() => {
    submitControllerRef.current?.abort();
    storeJobId(null);
    setActiveJobId(null);
    setJob(null);
    setIsSubmitting(false);
    setIsRestoring(false);
    setIsReconnecting(false);
    setError(null);
    catalogSignalsRef.current.clear();
  }, []);

  const retryConnection = useCallback(() => {
    setError(null);
    setIsReconnecting(false);
    setPollVersion((current) => current + 1);
  }, []);

  return {
    job,
    isSubmitting,
    isRestoring,
    isReconnecting,
    error,
    hasActiveJob: Boolean(job && shouldContinuePolling(job)),
    startImport,
    retryConnection,
    reset,
  };
}
