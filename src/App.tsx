import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, Search, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ArtifactInspector from './components/ArtifactInspector';
import GalleryGlobe from './components/GalleryGlobe';
import LoadingOverlay from './components/LoadingOverlay';
import WorldsHome from './components/WorldsHome';
import { useFastTrackRun } from './hooks/useFastTrackRun';
import type {
  FastTrackArtifact,
  FastTrackManifest,
  FastTrackStatus,
  WorldFilter,
  WorldNode,
} from './types/fastTrack';

const FILTERS: Array<{ id: WorldFilter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'research', label: 'Investigación' },
  { id: 'images', label: 'Imágenes' },
  { id: 'bible', label: 'Bible' },
  { id: 'video', label: 'Video' },
  { id: 'data', label: 'Datos' },
];

const STATUS_COPY: Record<string, { label: string; tone: 'ready' | 'active' | 'blocked' }> = {
  extracting: { label: 'Extrayendo', tone: 'active' },
  failed: { label: 'Extracción fallida', tone: 'blocked' },
  'needs-background': { label: 'Fondo requerido', tone: 'blocked' },
  'blocked-watermark': { label: 'Auditoría bloqueada', tone: 'blocked' },
  'research-ready': { label: 'Investigación lista', tone: 'ready' },
  'building-bible': { label: 'Creando Product Bible', tone: 'active' },
  'generating-video': { label: 'Generando video', tone: 'active' },
  complete: { label: 'Producción completa', tone: 'ready' },
};

function nodeFromArtifact(artifact: FastTrackArtifact): WorldNode {
  const category = artifact.stage
    ?? (artifact.kind === 'image' ? 'images' : artifact.kind === 'video' ? 'video' : 'data');
  const isGptImageBible = artifact.label.toLowerCase().includes('gpt image 2');
  const isFinalVideo = artifact.role === 'final_video';

  return {
    id: `artifact-${artifact.id}`,
    label: artifact.label,
    category,
    kind: artifact.kind,
    summary: isGptImageBible
      ? 'Product Bible técnica asistida por GPT Image 2 y ensamblada con cinco fotografías reales, sin redibujar el producto.'
      : isFinalVideo
        ? 'Entrega final vertical de Fast Track, preparada para inspección y reproducción en el globo.'
        : `${artifact.kind.toUpperCase()} generado por Fast Track y disponible para inspección.`,
    evidence: isGptImageBible ? 'GPT Image 2 + composición determinista · 5 fotos reales' : artifact.label,
    state: 'ready',
    artifactId: artifact.id,
    thumbnailUrl: artifact.kind === 'image' ? artifact.displayUrl ?? artifact.url : undefined,
    transparentUrl: artifact.kind === 'image' ? artifact.transparentUrl : undefined,
    imageFit: artifact.kind === 'image' ? (artifact.transparentUrl ? 'contain' : 'cover') : undefined,
    imageAlt: artifact.label,
    metadata: {
      mimeType: artifact.mimeType,
      role: artifact.role ?? 'artifact',
      bytes: artifact.size,
      backgroundMode: artifact.backgroundMode,
    },
  };
}

export default function App() {
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(() => (
    new URLSearchParams(window.location.search).get('world')
  ));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => (
    new URLSearchParams(window.location.search).get('run')
  ));

  useEffect(() => {
    const handlePopState = () => {
      const query = new URLSearchParams(window.location.search);
      setSelectedWorldId(query.get('world'));
      setSelectedRunId(query.get('run'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openWorld = (productId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run');
    url.searchParams.set('world', productId);
    window.history.pushState({}, '', url);
    setSelectedRunId(null);
    setSelectedWorldId(productId);
  };

  const closeWorld = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run');
    url.searchParams.delete('world');
    window.history.pushState({}, '', url);
    setSelectedRunId(null);
    setSelectedWorldId(null);
  };

  if (selectedWorldId) {
    return (
      <ProductWorldDetail
        key={`world-${selectedWorldId}`}
        productId={selectedWorldId}
        manifestUrl={`/api/product-worlds/worlds/${encodeURIComponent(selectedWorldId)}/manifest`}
        onBack={closeWorld}
      />
    );
  }

  return selectedRunId
    ? <ProductWorldDetail key={`run-${selectedRunId}`} runId={selectedRunId} onBack={closeWorld} />
    : <WorldsHome onOpenWorld={openWorld} />;
}

function ProductWorldDetail({
  runId,
  productId,
  manifestUrl,
  onBack,
}: {
  runId?: string;
  productId?: string;
  manifestUrl?: string;
  onBack: () => void;
}) {
  const { manifest, isLoading, isRefreshing, error, lastUpdated, refresh } = useFastTrackRun({
    runId,
    productId,
    manifestUrl,
  });
  const [activeFilter, setActiveFilter] = useState<WorldFilter>('all');
  const [selectedNode, setSelectedNode] = useState<WorldNode | null>(null);

  useEffect(() => {
    if (!manifest?.nodes.length) {
      setSelectedNode(null);
      return;
    }

    setSelectedNode((current) => {
      if (!current) return manifest.nodes[0];

      const currentArtifact = current.artifactId
        ? manifest.artifacts.find((artifact) => artifact.id === current.artifactId)
        : undefined;
      const currentRole = currentArtifact?.role ?? current.metadata?.role;
      const canonicalVideoArtifactId = manifest.run.finalVideoArtifactId;

      if (
        currentRole === 'final_video'
        && canonicalVideoArtifactId
        && current.artifactId !== canonicalVideoArtifactId
      ) {
        const canonicalNode = manifest.nodes.find(
          (node) => node.artifactId === canonicalVideoArtifactId,
        );
        if (canonicalNode) return canonicalNode;

        const canonicalArtifact = manifest.artifacts.find(
          (artifact) => artifact.id === canonicalVideoArtifactId,
        );
        if (canonicalArtifact) return nodeFromArtifact(canonicalArtifact);
      }

      const reconciledNode = manifest.nodes.find((node) => node.id === current.id)
        ?? (current.artifactId
          ? manifest.nodes.find((node) => node.artifactId === current.artifactId)
          : undefined);
      if (reconciledNode) return reconciledNode;
      if (currentArtifact) return nodeFromArtifact(currentArtifact);
      return manifest.nodes[0];
    });
  }, [manifest]);

  const visibleNodes = useMemo(() => {
    if (!manifest) return [];
    return activeFilter === 'all'
      ? manifest.nodes
      : manifest.nodes.filter((node) => node.category === activeFilter);
  }, [activeFilter, manifest]);

  if (isLoading && !manifest) return <LoadingOverlay label="Conectando con Fast Track" />;

  if (!manifest || error) {
    return <ErrorScreen message={error ?? 'No se recibió un manifiesto válido.'} onRetry={refresh} />;
  }

  const openArtifact = (artifact: FastTrackArtifact) => {
    setSelectedNode(nodeFromArtifact(artifact));
  };

  return (
    <div className="h-full overflow-y-auto bg-app-bg text-app-text lg:overflow-hidden">
      <ProductHeader
        manifest={manifest}
        isRefreshing={isRefreshing}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        onBack={onBack}
      />

      <main className="grid min-w-0 min-h-[calc(100dvh-78px)] lg:h-[calc(100%-78px)] lg:min-h-0 lg:grid-cols-[58%_42%]">
        <section className="flex min-w-0 h-[62vh] min-h-[480px] flex-col overflow-hidden border-b border-app-border lg:h-full lg:min-h-0 lg:border-b-0">
          <FilterRail
            manifest={manifest}
            activeFilter={activeFilter}
            onChange={setActiveFilter}
          />
          <div className="min-h-0 min-w-0 flex-1">
            {visibleNodes.length > 0 ? (
              <GalleryGlobe key={activeFilter} nodes={visibleNodes} onSelect={setSelectedNode} />
            ) : (
              <div className="grid h-full place-items-center bg-grid-faint px-8 text-center">
                <div>
                  <p className="font-mono text-sm uppercase tracking-[0.14em] text-app-muted">Sin nodos en esta etapa</p>
                  <button onClick={() => setActiveFilter('all')} className="mt-3 font-mono text-[10px] uppercase text-app-accent">
                    Ver todos
                  </button>
                </div>
              </div>
            )}
          </div>
          <PipelineRail manifest={manifest} />
        </section>

        <div className="min-h-[720px] min-w-0 lg:min-h-0">
          <ArtifactInspector
            manifest={manifest}
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
            onOpenArtifact={openArtifact}
          />
        </div>
      </main>
    </div>
  );
}

function ProductHeader({
  manifest,
  isRefreshing,
  lastUpdated,
  onRefresh,
  onBack,
}: {
  manifest: FastTrackManifest;
  isRefreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const status = STATUS_COPY[manifest.run.status] ?? {
    label: manifest.run.status.replaceAll('-', ' '),
    tone: 'active' as const,
  };

  return (
    <header className="flex h-[78px] items-center border-b border-app-border bg-[#05080c] px-4 md:px-6">
      <div className="flex w-full items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="grid size-10 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
            aria-label="Volver a mundos de producto"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="grid size-11 shrink-0 place-items-center border border-app-border text-xl text-app-accent">◎</div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold uppercase leading-none tracking-[0.03em] md:text-3xl">Product World</h1>
            <p className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.16em] text-app-muted md:text-[9px]">Fast Track · universo de un producto</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-6 md:flex xl:gap-10">
          <HeaderMetric label="Producto" value={manifest.product.shortName ?? manifest.product.title} warm wide />
          <HeaderMetric label="Precio" value={manifest.product.price ?? '—'} warm />
          <HeaderMetric label="Calificación" value={manifest.product.rating ? `★ ${manifest.product.rating}` : '—'} />
          <HeaderMetric label="Vendidos" value={String(manifest.product.sold ?? '—')} />
          <div className="min-w-36">
            <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-app-muted">Estado</p>
            <p className={`mt-1 flex items-center gap-2 whitespace-nowrap font-mono text-[10px] uppercase ${status.tone === 'blocked' ? 'text-product-accent' : 'text-app-accent'}`}>
              <span className={`size-1.5 ${status.tone === 'active' ? 'animate-pulse bg-app-accent' : status.tone === 'blocked' ? 'bg-product-accent' : 'bg-[#80e6b0]'}`} />
              {status.label}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="grid size-10 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
          aria-label={lastUpdated ? `Actualizar. Última lectura ${lastUpdated.toLocaleTimeString('es-MX')}` : 'Actualizar'}
        >
          <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  );
}

function HeaderMetric({ label, value, warm = false, wide = false }: { label: string; value: string; warm?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'min-w-0 max-w-72' : 'shrink-0'}>
      <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-app-muted">{label}</p>
      <p className={`mt-1 truncate font-mono text-[11px] uppercase ${warm ? 'text-product-accent' : 'text-app-accent'}`}>{value}</p>
    </div>
  );
}

function FilterRail({
  manifest,
  activeFilter,
  onChange,
}: {
  manifest: FastTrackManifest;
  activeFilter: WorldFilter;
  onChange: (filter: WorldFilter) => void;
}) {
  return (
    <nav className="flex h-12 shrink-0 overflow-x-auto border-b border-app-border bg-app-bg px-3" aria-label="Filtros del mundo">
      {FILTERS.map((filter) => {
        const count = filter.id === 'all'
          ? manifest.nodes.length
          : manifest.nodes.filter((node) => node.category === filter.id).length;
        return (
          <button
            key={filter.id}
            onClick={() => onChange(filter.id)}
            aria-pressed={activeFilter === filter.id}
            className={`flex shrink-0 items-center gap-2 border-x px-4 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors ${
              activeFilter === filter.id
                ? 'border-app-accent bg-app-accent/8 text-app-accent'
                : 'border-transparent text-app-muted hover:text-app-text'
            }`}
          >
            {filter.label}
            <span className="text-[8px] opacity-60">{count}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PipelineRail({ manifest }: { manifest: FastTrackManifest }) {
  const hasBible = manifest.artifacts.some((artifact) => artifact.role?.includes('bible'));
  const hasFinalVideo = manifest.artifacts.some((artifact) => artifact.role === 'final_video');
  const videoActive = manifest.run.status === 'generating-video';

  return (
    <div className="grid min-h-14 shrink-0 grid-cols-3 border-t border-app-border bg-[#06090d] px-3 md:px-5">
      <Stage icon={<Search className="size-4" />} title="Investigación" subtitle={`${manifest.reviews.capturedCount}/${manifest.reviews.total} reseñas`} state="ready" />
      <Stage icon={<CheckCircle2 className="size-4" />} title="Bible" subtitle={hasBible ? 'Imagen maestra lista' : 'Pendiente'} state={hasBible ? 'ready' : 'pending'} />
      <Stage
        icon={<Video className="size-4" />}
        title="Video"
        subtitle={hasFinalVideo
          ? `${manifest.run.durationSeconds ? `${manifest.run.durationSeconds} s · ` : ''}1080p listo`
          : videoActive ? 'Generando video' : 'Pendiente'}
        state={hasFinalVideo ? 'ready' : videoActive ? 'active' : 'pending'}
      />
    </div>
  );
}

function Stage({
  icon,
  title,
  subtitle,
  state,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  state: 'ready' | 'active' | 'pending';
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 border-l border-app-border px-2 first:border-l-0 md:px-4 ${state === 'pending' ? 'opacity-45' : ''}`}>
      <span className={state === 'active' ? 'animate-pulse text-product-accent' : 'text-app-accent'}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-app-text">{title}</p>
        <p className="mt-0.5 truncate font-mono text-[7px] text-app-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="product-grid grid h-full place-items-center px-6">
      <div className="max-w-lg border border-product-accent/60 bg-app-surface p-7 text-center">
        <AlertTriangle className="mx-auto size-8 text-product-accent" />
        <h1 className="mt-4 font-display text-3xl font-bold uppercase">Fast Track no disponible</h1>
        <p className="mt-3 text-sm leading-6 text-app-muted">{message}</p>
        <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 border border-app-accent px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-app-accent">
          <RefreshCw className="size-4" /> Reintentar
        </button>
      </div>
    </main>
  );
}
