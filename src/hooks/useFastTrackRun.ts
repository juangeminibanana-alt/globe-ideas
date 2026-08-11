import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArtifactKind,
  FastTrackArtifact,
  FastTrackManifest,
  FastTrackRunsResponse,
  FastTrackStatus,
  ReviewSample,
  WorldCategory,
  WorldNode,
} from '../types/fastTrack';

const DEFAULT_PRODUCT_ID = '1735785778453579666';
const ACTIVE_POLL_INTERVAL_MS = 3_000;
const COMPLETE_POLL_INTERVAL_MS = 12_000;
const manifestCache = new Map<string, FastTrackManifest>();

function pollIntervalForStatus(status: FastTrackStatus | undefined): number | null {
  if (!status || ['failed', 'blocked-watermark'].includes(status)) return null;
  return status === 'complete' ? COMPLETE_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeStatus(rawStatus: unknown, artifacts: FastTrackArtifact[]): FastTrackStatus {
  const status = text(rawStatus);
  if (status === 'complete') return 'complete';
  if (status === 'awaiting_input') return 'needs-background';
  if (status === 'needs_review') return 'blocked-watermark';
  if (status === 'failed') return 'failed';
  if (status === 'discovered') return 'extracting';
  if (status === 'processing') {
    if (artifacts.some((artifact) => artifact.stage === 'video' && artifact.kind !== 'video')) {
      return 'generating-video';
    }
    if (artifacts.some((artifact) => artifact.stage === 'bible')) return 'generating-video';
    return 'building-bible';
  }
  return status || 'extracting';
}

function stageForArtifact(role: string, filename: string, kind: ArtifactKind): WorldCategory {
  const search = `${role} ${filename}`.toLowerCase();
  if (kind === 'video') return 'video';
  if (search.includes('bible') || search.includes('reference_sheet') || search.includes('ref sheet')) return 'bible';
  if (kind === 'image') return 'images';
  return 'data';
}

function normalizeArtifacts(rawArtifacts: unknown): FastTrackArtifact[] {
  if (!Array.isArray(rawArtifacts)) return [];
  return rawArtifacts.map((raw) => {
    const source = record(raw);
    const backendKind = text(source.kind, 'text');
    const kind: ArtifactKind = backendKind === 'table'
      ? 'csv'
      : ['image', 'video', 'json', 'text', 'html'].includes(backendKind)
        ? backendKind as ArtifactKind
        : 'other';
    const role = text(source.role, 'supporting_artifact');
    const filename = text(source.filename, text(source.label, 'artifact'));
    const backgroundMode = text(source.backgroundMode);
    const normalizedBackgroundMode: FastTrackArtifact['backgroundMode'] =
      backgroundMode === 'transparent' || backgroundMode === 'preserved'
        ? backgroundMode
        : undefined;
    return {
      id: text(source.id),
      kind,
      label: text(source.label, filename),
      filename,
      mimeType: text(source.mimeType, 'application/octet-stream'),
      size: number(source.size),
      url: text(source.url),
      displayUrl: text(source.displayUrl) || undefined,
      transparentUrl: text(source.transparentUrl) || undefined,
      backgroundMode: normalizedBackgroundMode,
      role,
      stage: stageForArtifact(role, filename, kind),
      modifiedAt: text(source.updatedAt) || undefined,
      durationSeconds: number(source.durationSeconds) || undefined,
    };
  }).filter((artifact) => Boolean(artifact.id && artifact.url));
}

function categoryForNode(source: UnknownRecord, artifact: FastTrackArtifact | undefined): WorldCategory {
  const kind = text(source.kind);
  if (kind === 'product' || kind === 'metric' || kind === 'review') return 'research';
  if (artifact?.stage) return artifact.stage;
  return 'data';
}

function normalizeNode(
  raw: unknown,
  index: number,
  artifacts: FastTrackArtifact[],
): WorldNode {
  const source = record(raw);
  const artifactId = text(source.artifactId) || undefined;
  const artifact = artifacts.find((item) => item.id === artifactId);
  const rawKind = text(source.kind, 'fact');
  const label = text(source.title, `Nodo ${index + 1}`);
  const value = source.value;
  const body = text(source.body);
  const eyebrow = text(source.eyebrow, artifact?.label ?? 'Fast Track');
  const category = categoryForNode(source, artifact);
  const state = category === 'video' && !artifact ? 'pending' : 'ready';
  const summary = rawKind === 'product'
    ? `Ficha de producto extraída para ${label}.`
    : body || (value !== null && value !== undefined ? `${label}: ${text(value)}` : eyebrow);
  const nodeKind = rawKind === 'review'
    ? 'review'
    : rawKind === 'metric' || rawKind === 'product'
      ? 'fact'
      : artifact?.kind ?? 'stage';
  const isDedicatedImageNode = rawKind === 'image' && artifact?.kind === 'image';
  const sourceDisplayUrl = text(source.displayUrl) || undefined;
  const transparentUrl = isDedicatedImageNode
    ? artifact.transparentUrl ?? (text(source.transparentUrl) || undefined)
    : undefined;
  const thumbnailUrl = isDedicatedImageNode
    ? artifact.displayUrl ?? artifact.url ?? sourceDisplayUrl
    : undefined;
  return {
    id: text(source.id, `node-${index}`),
    label,
    category,
    kind: nodeKind,
    summary,
    evidence: artifact?.label ?? eyebrow,
    state,
    artifactId,
    thumbnailUrl,
    transparentUrl,
    imageFit: transparentUrl ? 'contain' : 'cover',
    imageAlt: label,
    badge: eyebrow,
    code: source.data ?? source,
    metadata: {
      ...(record(source.data)),
      ...(artifact ? {
        role: artifact.role,
        mimeType: artifact.mimeType,
        bytes: artifact.size,
        backgroundMode: artifact.backgroundMode,
        durationSeconds: artifact.durationSeconds,
        canonical: source.canonical === true,
      } : {}),
    },
  };
}

function removeRepeatedNodeImages(nodes: WorldNode[]): WorldNode[] {
  const displayedImages = new Map<string, WorldNode>();

  return nodes.map((node) => {
    const visualUrl = node.transparentUrl ?? node.thumbnailUrl;
    if (!visualUrl) return node;

    const originalNode = displayedImages.get(visualUrl);
    if (!originalNode) {
      displayedImages.set(visualUrl, node);
      return node;
    }

    return {
      ...node,
      thumbnailUrl: undefined,
      transparentUrl: undefined,
      imageFit: undefined,
      badge: 'IMAGEN DUPLICADA · OCULTA',
      metadata: {
        ...node.metadata,
        duplicateVisualHidden: true,
        duplicateVisualOf: originalNode.id,
      },
    };
  });
}

function normalizeManifest(raw: unknown): FastTrackManifest {
  const source = record(raw);
  const rawRun = record(source.run);
  const rawProduct = record(source.product);
  const rawPrice = record(rawProduct.price);
  const rawShipping = record(rawProduct.shipping);
  const rawSeller = record(rawProduct.seller);
  const rawMetrics = record(source.metrics);
  const rawReviews = record(source.reviews);
  const artifacts = normalizeArtifacts(source.artifacts);
  const heroImageUrl = text(rawProduct.heroUrl) || undefined;
  const heroDisplayUrl = text(rawProduct.heroDisplayUrl) || heroImageUrl;
  const heroTransparentUrl = text(rawProduct.heroTransparentUrl) || undefined;
  const status = normalizeStatus(rawRun.status, artifacts);
  const title = text(rawProduct.title, text(rawRun.title, 'Producto Fast Track'));

  const reviewSample: ReviewSample[] = Array.isArray(rawReviews.sample)
    ? rawReviews.sample.map((review, index) => {
      const item = record(review);
      const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls : [];
      return {
        id: text(item.id, `review-${index}`),
        author: text(item.author) || undefined,
        rating: typeof item.rating === 'number' ? item.rating : undefined,
        text: text(item.text, 'Reseña sin texto capturado.'),
        verified: item.verifiedPurchase === true,
        incentivized: item.incentivized === true,
        imageCount: imageUrls.length,
      };
    })
    : [];

  const baseNodes = Array.isArray(source.nodes)
    ? source.nodes.map((node, index) => normalizeNode(
        node,
        index,
        artifacts,
      ))
    : [];
  const hasBible = artifacts.some((artifact) => artifact.stage === 'bible');
  const preferredFinalVideoArtifactId = text(rawRun.finalVideoArtifactId) || undefined;
  const finalVideo = (preferredFinalVideoArtifactId
    ? artifacts.find((artifact) => artifact.id === preferredFinalVideoArtifactId)
    : undefined)
    ?? artifacts.find((artifact) => artifact.role === 'final_video');
  const finalVideoArtifactId = finalVideo?.id ?? preferredFinalVideoArtifactId;
  const runFinalVideoDuration = number(rawRun.durationSeconds);
  const finalVideoDuration = finalVideo?.durationSeconds ?? (runFinalVideoDuration || undefined);
  const finalVideoUrl = text(rawRun.finalVideoUrl) || finalVideo?.url;
  const preferredBible = artifacts.find((artifact) => artifact.filename === 'phu_product_bible_gpt_image_2_16x9.png')
    ?? artifacts.find((artifact) => artifact.role === 'product_bible');
  const stageNodes: WorldNode[] = [
    {
      id: 'stage-product-bible',
      label: 'Product Bible',
      category: 'bible',
      kind: 'stage',
      summary: hasBible ? 'Bible maestra generada a partir de referencias reales.' : 'Pendiente de generación.',
      evidence: hasBible ? 'phu_bible' : 'Fast Track · etapa 6',
      state: hasBible ? 'ready' : status === 'building-bible' ? 'active' : 'pending',
      artifactId: preferredBible?.id,
      thumbnailUrl: preferredBible?.displayUrl ?? preferredBible?.url,
      transparentUrl: preferredBible?.transparentUrl,
      imageFit: preferredBible?.transparentUrl ? 'contain' : 'cover',
      badge: hasBible ? 'BIBLE LISTA' : 'BIBLE PENDIENTE',
    },
    {
      id: 'stage-final-video',
      label: 'Video final 1080p',
      category: 'video',
      kind: 'video',
      summary: finalVideo
        ? `Entrega vertical${finalVideoDuration ? ` de ${finalVideoDuration} segundos` : ''} escalada localmente a 1080×1920.`
        : 'Video todavía no disponible.',
      evidence: finalVideo?.label ?? 'Fast Track · etapa 7–8',
      state: finalVideo ? 'ready' : status === 'generating-video' ? 'active' : 'pending',
      artifactId: finalVideo?.id,
      badge: finalVideo ? 'ENTREGA FINAL' : 'VIDEO PENDIENTE',
    },
  ];
  const nodesWithStages = baseNodes.length > 0 ? baseNodes : stageNodes;
  const nodes = removeRepeatedNodeImages(nodesWithStages);

  const currentPrice = text(rawPrice.current);
  const priceSymbol = text(rawPrice.symbol);
  const priceCurrency = text(rawPrice.currency);
  const displayPrice = currentPrice
    ? `${priceSymbol && !currentPrice.includes(priceSymbol) ? priceSymbol : ''}${currentPrice}${priceCurrency && !currentPrice.includes(priceCurrency) ? ` ${priceCurrency}` : ''}`
    : undefined;

  return {
    schemaVersion: text(source.schemaVersion, '1.0'),
    run: {
      id: text(rawRun.id),
      productId: text(rawRun.productId, text(rawProduct.id)),
      title: text(rawRun.title, title),
      status,
      updatedAt: text(rawRun.updatedAt, new Date().toISOString()),
      completedAt: text(rawRun.completedAt) || undefined,
      durationSeconds: finalVideoDuration,
      finalVideoArtifactId,
      finalVideoUrl,
      stage: status,
      sourceUrl: text(rawProduct.sourceUrl) || undefined,
    },
    product: {
      id: text(rawProduct.id),
      title,
      shortName: title.split(/\s+/).slice(0, 5).join(' '),
      price: displayPrice,
      originalPrice: text(rawPrice.original) || undefined,
      discount: text(rawPrice.discount) || undefined,
      saving: text(rawPrice.saving) || undefined,
      rating: rawMetrics.rating as number | undefined,
      sold: rawMetrics.soldCount as number | undefined,
      shipping: text(rawShipping.label) || undefined,
      seller: text(rawSeller.name) || undefined,
      stock: rawMetrics.totalStock as number | undefined,
      category: Array.isArray(rawProduct.categories)
        ? rawProduct.categories.map((category) => text(record(category).name)).filter(Boolean).join(' › ')
        : undefined,
      heroImageUrl,
      heroDisplayUrl,
      heroTransparentUrl,
      description: Array.isArray(rawProduct.description)
        ? rawProduct.description.map((item) => text(item)).filter(Boolean)
        : [],
    },
    metrics: {
      rating: rawMetrics.rating as number | undefined,
      sold: rawMetrics.soldCount as number | undefined,
      reviews: rawMetrics.reviewCount as number | undefined,
      images: number(rawMetrics.imageCount),
      artifacts: artifacts.length,
      stock: rawMetrics.totalStock as number | undefined,
    },
    reviews: {
      total: number(rawReviews.total),
      capturedCount: number(rawReviews.capturedCount),
      hasMore: rawReviews.hasMore === true,
      sample: reviewSample,
    },
    artifacts,
    nodes,
  };
}

interface UseFastTrackRunOptions {
  productId?: string;
  runId?: string;
  manifestUrl?: string;
}

export function useFastTrackRun({
  productId = DEFAULT_PRODUCT_ID,
  runId: requestedRunId,
  manifestUrl,
}: UseFastTrackRunOptions = {}) {
  const [manifest, setManifest] = useState<FastTrackManifest | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);

  const load = useCallback(async (background = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (background) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      let selectedRunId = requestedRunId ?? runIdRef.current;
      let endpoint = manifestUrl;
      if (!endpoint && !selectedRunId) {
        const runsResponse = await fetch('/api/fast-track/runs', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!runsResponse.ok) throw new Error(`No se pudo consultar Fast Track (${runsResponse.status})`);
        const runs = await runsResponse.json() as FastTrackRunsResponse;
        if (!runs.rootAvailable) throw new Error('La carpeta de resultados Fast Track no está disponible.');

        const queryRun = new URLSearchParams(window.location.search).get('run');
        const selected = runs.runs.find((run) => run.id === queryRun)
          ?? runs.runs.find((run) => run.productId === productId)
          ?? runs.runs[0];
        if (!selected) throw new Error('No hay ejecuciones Fast Track disponibles.');
        selectedRunId = selected.id;
        runIdRef.current = selected.id;
        setRunId(selected.id);
      }

      endpoint ??= `/api/fast-track/runs/${encodeURIComponent(selectedRunId ?? '')}/manifest`;
      const manifestResponse = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
      if (!manifestResponse.ok) throw new Error(`No se pudo cargar el manifiesto (${manifestResponse.status})`);
      const nextManifest = normalizeManifest(await manifestResponse.json());
      const cacheKey = manifestUrl ?? selectedRunId ?? nextManifest.run.id;
      manifestCache.set(cacheKey, nextManifest);
      runIdRef.current = nextManifest.run.id;
      setRunId(nextManifest.run.id);
      setManifest(nextManifest);
      setLastUpdated(new Date());
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Error desconocido al leer Fast Track.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [manifestUrl, productId, requestedRunId]);

  useEffect(() => {
    const cacheKey = manifestUrl ?? requestedRunId;
    const cachedManifest = cacheKey ? manifestCache.get(cacheKey) ?? null : null;
    runIdRef.current = requestedRunId ?? null;
    setRunId(requestedRunId ?? null);
    setManifest(cachedManifest);
    setLastUpdated(cachedManifest ? new Date() : null);
    setError(null);
    void load(Boolean(cachedManifest));
    return () => requestRef.current?.abort();
  }, [load, manifestUrl, requestedRunId]);

  const pollIntervalMs = pollIntervalForStatus(manifest?.run.status);

  useEffect(() => {
    if (pollIntervalMs === null) return;
    const timer = window.setInterval(() => void load(true), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [load, pollIntervalMs]);

  return {
    manifest,
    runId,
    isLoading,
    isRefreshing,
    error,
    lastUpdated,
    refresh: () => load(Boolean(manifest)),
  };
}

export function useFastTrackRuns() {
  const [runs, setRuns] = useState<FastTrackRunsResponse['runs']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (background) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const response = await fetch('/api/fast-track/runs', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`No se pudo consultar Fast Track (${response.status})`);
      const payload = await response.json() as FastTrackRunsResponse;
      if (!payload.rootAvailable) throw new Error('La carpeta de resultados Fast Track no está disponible.');
      setRuns(payload.runs);
      setLastUpdated(new Date());
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Error desconocido al leer Fast Track.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), COMPLETE_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, [load]);

  return {
    runs,
    isLoading,
    isRefreshing,
    error,
    lastUpdated,
    refresh: () => load(Boolean(runs.length)),
  };
}
