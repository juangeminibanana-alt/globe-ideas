import { AlertTriangle, ArrowLeft, Camera, Check, CheckCircle2, Eye, Images, Minimize2, Moon, RefreshCw, Search, Sun, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ArtifactInspector from './components/ArtifactInspector';
import EvidenceGalleryModal from './components/EvidenceGalleryModal';
import GalleryGlobe from './components/GalleryGlobe';
import LoadingOverlay from './components/LoadingOverlay';
import NarrativeAngleFilter, { matchesNarrativeAngle, type NarrativeAngle } from './components/NarrativeAngleFilter';
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
  const isProductBible = artifact.stage === 'bible' || artifact.role?.includes('bible');
  const isFinalVideo = artifact.role === 'final_video';

  return {
    id: `artifact-${artifact.id}`,
    label: artifact.label,
    category,
    kind: artifact.kind,
    summary: isProductBible
      ? 'Product Bible disponible en el manifiesto de este producto.'
      : isFinalVideo
        ? 'Entrega final vertical de Fast Track, preparada para inspección y reproducción en el globo.'
        : `${artifact.kind.toUpperCase()} generado por Fast Track y disponible para inspección.`,
    evidence: artifact.label,
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

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('app-theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return selectedRunId
    ? (
        <ProductWorldDetail
          key={`run-${selectedRunId}`}
          runId={selectedRunId}
          onBack={closeWorld}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )
    : (
        <WorldsHome
          onOpenWorld={openWorld}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      );
}

function ProductWorldDetail({
  runId,
  productId,
  manifestUrl,
  onBack,
  theme,
  onToggleTheme,
}: {
  runId?: string;
  productId?: string;
  manifestUrl?: string;
  onBack: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const { manifest, isLoading, isRefreshing, error, lastUpdated, refresh } = useFastTrackRun({
    runId,
    productId,
    manifestUrl,
  });
  const [activeFilter, setActiveFilter] = useState<WorldFilter>('all');
  const [activeNarrativeAngle, setActiveNarrativeAngle] = useState<NarrativeAngle>('all');
  const [selectedNode, setSelectedNode] = useState<WorldNode | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isCinematicMode, setIsCinematicMode] = useState(false);

  useEffect(() => {
    if (!isCinematicMode) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsCinematicMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCinematicMode]);

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
    let nodes = activeFilter === 'all'
      ? manifest.nodes
      : manifest.nodes.filter((node) => node.category === activeFilter);

    if (activeNarrativeAngle !== 'all') nodes = nodes.filter((node) => matchesNarrativeAngle(node, activeNarrativeAngle));

    return nodes;
  }, [activeFilter, activeNarrativeAngle, manifest]);

  const narrativeCounts = useMemo(() => {
    const angles: NarrativeAngle[] = ['all', 'problema-solucion', 'estilo-vida', 'unboxing', 'comparativa', 'demostracion'];
    return Object.fromEntries(angles.map((angle) => [
      angle,
      manifest?.nodes.filter((node) => matchesNarrativeAngle(node, angle)).length ?? 0,
    ])) as Record<NarrativeAngle, number>;
  }, [manifest]);

  if (isLoading && !manifest) return <LoadingOverlay label="Conectando con Fast Track" />;

  if (!manifest || error) {
    return <ErrorScreen message={error ?? 'No se recibió un manifiesto válido.'} onRetry={refresh} />;
  }

  const openArtifact = (artifact: FastTrackArtifact) => {
    setSelectedNode(nodeFromArtifact(artifact));
  };

  return (
    <div className={`relative h-[100dvh] w-full bg-app-bg text-app-text flex flex-col ${isCinematicMode ? 'overflow-hidden' : 'overflow-y-auto lg:overflow-hidden'}`}>
      {!isCinematicMode && (
        <ProductHeader
          manifest={manifest}
          isRefreshing={isRefreshing}
          lastUpdated={lastUpdated}
          theme={theme}
          onToggleCinematic={() => setIsCinematicMode(true)}
          onToggleTheme={onToggleTheme}
          onOpenGallery={() => setIsGalleryOpen(true)}
          onRefresh={refresh}
          onBack={onBack}
        />
      )}

      <main className={`relative w-full ${
        isCinematicMode
          ? 'flex min-h-0 flex-1 overflow-hidden'
          : 'grid min-h-[calc(100dvh-78px)] grid-cols-1 lg:h-[calc(100%-78px)] lg:min-h-0 lg:grid-cols-[58%_42%] lg:overflow-hidden'
      }`}>
        <section className={`relative flex min-w-0 flex-col overflow-hidden ${isCinematicMode ? 'h-full flex-1' : 'h-[62vh] min-h-[480px] border-b border-app-border lg:h-full lg:min-h-0 lg:border-b-0'}`}>
          {!isCinematicMode && (
            <FilterRail
              manifest={manifest}
              activeFilter={activeFilter}
              onChange={setActiveFilter}
            />
          )}

          <div className="relative min-h-0 min-w-0 flex-1 h-full w-full">
            {!isCinematicMode && (
              <NarrativeAngleFilter
                activeAngle={activeNarrativeAngle}
                onChangeAngle={setActiveNarrativeAngle}
                nodeCounts={narrativeCounts}
              />
            )}

            {/* Quick Cinematic Button on Globe */}
            {!isCinematicMode && (
              <div className="absolute bottom-4 left-4 z-20">
                <button
                  onClick={() => setIsCinematicMode(true)}
                  className="flex items-center gap-2 border border-app-border bg-app-surface/90 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-app-text backdrop-blur-md shadow-xl transition-all hover:border-app-accent hover:text-app-accent hover:scale-105"
                  title="Ocultar paneles y ver globo 3D a pantalla completa"
                >
                  <Eye className="size-3.5 text-app-accent" />
                  <span>Modo Cinemático</span>
                </button>
              </div>
            )}

            {/* Exit Cinematic Mode Floating Button */}
            {isCinematicMode && (
              <div className="absolute top-4 right-4 z-50 animate-fadeIn">
                <button
                  onClick={() => setIsCinematicMode(false)}
                  className="flex items-center gap-2 border border-app-accent bg-slate-950/90 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-app-accent backdrop-blur-xl shadow-2xl transition-all hover:bg-app-accent hover:text-slate-950 hover:scale-105"
                >
                  <Minimize2 className="size-4" />
                  <span>Salir de Modo Cinemático</span>
                </button>
              </div>
            )}

            {visibleNodes.length > 0 ? (
              <GalleryGlobe
                key={`${activeFilter}-${activeNarrativeAngle}`}
                nodes={visibleNodes}
                onSelect={setSelectedNode}
                hotspotsEnabled={!isGalleryOpen}
              />
            ) : (
              <div className="grid h-full place-items-center bg-grid-faint px-8 text-center">
                <div>
                  <p className="font-mono text-sm uppercase tracking-[0.14em] text-app-muted">Sin nodos para este filtro</p>
                  <button
                    onClick={() => {
                      setActiveFilter('all');
                      setActiveNarrativeAngle('all');
                    }}
                    className="mt-3 font-mono text-[10px] uppercase text-app-accent"
                  >
                    Restablecer filtros
                  </button>
                </div>
              </div>
            )}
          </div>

          {!isCinematicMode && <PipelineRail manifest={manifest} />}
        </section>

        {!isCinematicMode && (
          <div className="min-h-[720px] min-w-0 border-l border-app-border lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <ArtifactInspector
              manifest={manifest}
              selectedNode={selectedNode}
              onClose={() => setSelectedNode(null)}
              onOpenArtifact={openArtifact}
            />
          </div>
        )}
      </main>

      {isGalleryOpen && (
        <EvidenceGalleryModal
          manifest={manifest}
          onClose={() => setIsGalleryOpen(false)}
          onSelectNode={setSelectedNode}
        />
      )}
    </div>
  );
}

function ProductHeader({
  manifest,
  isRefreshing,
  lastUpdated,
  theme,
  onToggleCinematic,
  onToggleTheme,
  onOpenGallery,
  onRefresh,
  onBack,
}: {
  manifest: FastTrackManifest;
  isRefreshing: boolean;
  lastUpdated: Date | null;
  theme: 'dark' | 'light';
  onToggleCinematic?: () => void;
  onToggleTheme: () => void;
  onOpenGallery: () => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const status = STATUS_COPY[manifest.run.status] ?? {
    label: manifest.run.status.replaceAll('-', ' '),
    tone: 'active' as const,
  };

  const [snapshotSuccess, setSnapshotSuccess] = useState(false);

  const handleTakeSnapshot = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.gallery-globe-shell canvas');
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const prodName = (manifest.product.shortName ?? manifest.product.title ?? 'product').replace(/\s+/g, '-').toLowerCase();
      link.download = `${prodName}-3d-globe-${timestamp}.png`;
      link.href = dataUrl;
      link.click();

      setSnapshotSuccess(true);
      setTimeout(() => setSnapshotSuccess(false), 2500);
    } catch (err) {
      console.error('Error capturing screenshot:', err);
    }
  };

  return (
    <header className="flex h-[68px] items-center border-b border-app-border bg-app-surface px-2 sm:h-[78px] sm:px-4 md:px-6">
      <div className="flex w-full items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={onBack}
            className="grid size-10 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
            aria-label="Volver a mundos de producto"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="hidden size-11 shrink-0 place-items-center border border-app-border text-xl text-app-accent sm:grid">◎</div>
          <div className="min-w-0">
            <h1 className="whitespace-nowrap font-display text-lg font-bold uppercase leading-none tracking-[0.03em] sm:text-xl md:text-2xl">
              <span className="sm:hidden">World</span>
              <span className="hidden sm:inline">Product World</span>
            </h1>
            <p className="mt-1 hidden truncate font-mono text-[8px] uppercase tracking-[0.16em] text-app-muted sm:block md:text-[9px]">Remix Anywhere · universo de un producto</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-6 2xl:flex xl:gap-10">
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            onClick={handleTakeSnapshot}
            className={`hidden h-10 items-center gap-2 border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-all shadow-sm md:flex ${
              snapshotSuccess
                ? 'border-emerald-500 bg-emerald-950/80 text-emerald-400'
                : 'border-app-border bg-app-bg text-app-text hover:border-app-accent hover:text-app-accent'
            }`}
            title="Descargar una captura PNG de la vista actual del globo 3D"
          >
            {snapshotSuccess ? (
              <>
                <Check className="size-4 text-emerald-400" />
                <span className="hidden 2xl:inline">Guardado PNG</span>
              </>
            ) : (
              <>
                <Camera className="size-4 text-app-accent" />
                <span className="hidden 2xl:inline">Capturar PNG</span>
              </>
            )}
          </button>

          {onToggleCinematic && (
            <button
              onClick={onToggleCinematic}
              className="hidden h-10 items-center gap-2 border border-app-border bg-app-bg px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-app-text transition-all hover:border-app-accent hover:text-app-accent shadow-sm md:flex"
              title="Ocultar paneles para ver globo 3D a pantalla completa"
            >
              <Eye className="size-4 text-app-accent" />
              <span className="hidden 2xl:inline">Modo Cinemático</span>
            </button>
          )}

          <button
            onClick={onOpenGallery}
            className="flex h-10 items-center gap-2 border border-app-accent bg-app-accent/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-app-accent transition-all hover:bg-app-accent hover:text-slate-950 shadow-sm"
            title={`Abrir galería interactiva de ${manifest.artifacts.length} evidencias`}
          >
            <Images className="size-4" />
            <span className="hidden 2xl:inline">Evidencias ({manifest.artifacts.length})</span>
          </button>

          <button
            onClick={onToggleTheme}
            className="flex h-10 items-center gap-2 border border-app-border bg-app-bg px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-app-text transition-colors hover:border-app-accent hover:text-app-accent"
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="size-4 text-amber-400" />
                <span className="hidden 2xl:inline">Modo Claro</span>
              </>
            ) : (
              <>
                <Moon className="size-4 text-indigo-500" />
                <span className="hidden 2xl:inline">Modo Oscuro</span>
              </>
            )}
          </button>

          <button
            onClick={onRefresh}
            className="grid size-10 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
            aria-label={lastUpdated ? `Actualizar. Última lectura ${lastUpdated.toLocaleTimeString('es-MX')}` : 'Actualizar'}
          >
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
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
    <div className="grid min-h-14 shrink-0 grid-cols-3 border-t border-app-border bg-app-subtle px-3 md:px-5">
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
