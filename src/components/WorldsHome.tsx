import { useMemo, useState } from 'react';
import {
  Sparkles,
  Search,
  Grid,
  Orbit,
  Sun,
  Moon,
  ArrowRight,
  CheckCircle2,
  Layers,
  RefreshCw,
  Eye,
  Minimize2,
  Camera,
  Check,
  LoaderCircle,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { useProductWorldCatalog } from '../hooks/useProductWorldCatalog';
import { useProductImport } from '../hooks/useProductImport';
import AddProductModal from './AddProductModal';
import LoadingOverlay from './LoadingOverlay';
import ProductWorldCanvas, { type ProductWorldCanvasItem } from './ProductWorldCanvas';

interface WorldsHomeProps {
  onOpenWorld: (productId: string) => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

type HomeViewMode = '3d-galaxy' | 'grid-catalog';

export default function WorldsHome({ onOpenWorld, theme, onToggleTheme }: WorldsHomeProps) {
  const { worlds, isLoading, isRefreshing, error, refresh } = useProductWorldCatalog();
  const [viewMode, setViewMode] = useState<HomeViewMode>('3d-galaxy');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCinematicMode, setIsCinematicMode] = useState(false);
  const [snapshotSuccess, setSnapshotSuccess] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const productImport = useProductImport({
    onCatalogReady: async () => {
      await refresh();
    },
  });

  const handleTakeSnapshot = () => {
    if (viewMode !== '3d-galaxy') return;
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `product-world-galaxy-${timestamp}.png`;
      link.href = dataUrl;
      link.click();

      setSnapshotSuccess(true);
      setTimeout(() => setSnapshotSuccess(false), 2500);
    } catch (err) {
      console.error('Error capturing galaxy screenshot:', err);
    }
  };

  // Filter worlds by search query
  const filteredWorlds = useMemo(() => {
    if (!searchQuery.trim()) return worlds;
    const q = searchQuery.toLowerCase().trim();
    return worlds.filter(
      (w) => (w.name || w.title || '').toLowerCase().includes(q) || w.productId.toLowerCase().includes(q)
    );
  }, [worlds, searchQuery]);

  const canvasWorlds = useMemo<ProductWorldCanvasItem[]>(() => {
    return filteredWorlds.map((world) => ({
      id: world.id,
      productId: world.productId,
      name: world.name || world.title,
      imageUrl: world.heroUrl,
      imageHasAlpha: world.heroHasAlpha,
    }));
  }, [filteredWorlds]);

  const totalSources = useMemo(
    () => worlds.reduce((total, world) => total + Math.max(1, world.sourceCount || 1), 0),
    [worlds],
  );
  const transparentWorlds = useMemo(
    () => worlds.filter((world) => world.heroHasAlpha).length,
    [worlds],
  );
  const featuredWorld = filteredWorlds[0];

  if (isLoading && !worlds.length) {
    return <LoadingOverlay label="Cargando Galaxia de Productos..." />;
  }

  return (
    <div className="relative flex h-full min-h-[100dvh] w-full flex-col overflow-hidden bg-app-bg text-app-text">
      {/* Top Header Bar */}
      {!isCinematicMode && (
        <header className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-app-border bg-app-surface/90 px-3 py-2 backdrop-blur-md md:px-5">
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <div className="hidden size-9 shrink-0 place-items-center border border-app-accent/60 bg-app-accent/15 text-app-accent shadow-sm sm:grid">
              <Orbit className="size-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="whitespace-nowrap font-display text-sm font-bold uppercase tracking-wider text-app-text lg:text-base">
                  <span className="hidden lg:inline">Product World · Remix Anywhere</span>
                  <span className="lg:hidden">Product Worlds</span>
                </h1>
                <span className="hidden border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-400 xl:inline-block">
                  CATÁLOGO LOCAL
                </span>
              </div>
              <p className="hidden font-mono text-[10px] uppercase tracking-wider text-app-muted xl:block">
                Investigación, evidencias y producción UGC por producto
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Search Input */}
            <div className="relative hidden w-48 xl:block 2xl:w-64">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-app-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto..."
                className="w-full border border-app-border bg-app-bg py-1.5 pl-8 pr-3 font-mono text-xs text-app-text placeholder:text-app-muted/60 focus:border-app-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-app-muted hover:text-app-text"
                >
                  ×
                </button>
              )}
            </div>

            {/* New Product Import */}
            <button
              type="button"
              onClick={() => setIsAddProductOpen(true)}
              className="flex h-9 shrink-0 items-center gap-1.5 border border-app-accent bg-app-accent px-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-app-accent/90"
              aria-haspopup="dialog"
              title={productImport.hasActiveJob ? 'Ver progreso del nuevo producto' : 'Agregar producto desde TikTok'}
            >
              {productImport.job?.status === 'needs-input' ? (
                <AlertTriangle className="size-3.5" />
              ) : productImport.isRestoring || productImport.hasActiveJob ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : productImport.job?.status === 'complete' ? (
                <Check className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
              <span className="hidden sm:inline">
                {productImport.isRestoring
                  ? 'Reconectando'
                  : productImport.job?.status === 'needs-input'
                    ? 'Pendiente en Codex'
                  : productImport.hasActiveJob
                    ? `Procesando${typeof productImport.job?.progress === 'number' ? ` ${Math.round(productImport.job.progress)}%` : ''}`
                    : productImport.job?.status === 'complete'
                      ? 'Producto listo'
                      : 'Agregar producto'}
              </span>
              <span className="sm:hidden">Agregar</span>
            </button>

            {/* Snapshot PNG Button */}
            <button
              onClick={handleTakeSnapshot}
              disabled={viewMode !== '3d-galaxy' || !canvasWorlds.length}
              className={`hidden h-9 items-center gap-1.5 border px-2.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm sm:flex ${
                snapshotSuccess
                  ? 'border-emerald-500 bg-emerald-950/80 text-emerald-400'
                  : viewMode !== '3d-galaxy' || !canvasWorlds.length
                    ? 'cursor-not-allowed border-app-border bg-app-bg text-app-muted opacity-45'
                    : 'border-app-border bg-app-bg text-app-text hover:border-app-accent hover:text-app-accent'
              }`}
              title={viewMode === '3d-galaxy' && canvasWorlds.length
                ? 'Descargar captura PNG de la vista 3D actual'
                : 'La captura PNG está disponible en Galaxia 3D'}
            >
              {snapshotSuccess ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span className="hidden xl:inline">Guardado PNG</span>
                </>
              ) : (
                <>
                  <Camera className="size-3.5 text-app-accent" />
                  <span className="hidden xl:inline">Capturar PNG</span>
                </>
              )}
            </button>

            {/* Cinematic Mode Toggle */}
            <button
              onClick={() => {
                setViewMode('3d-galaxy');
                setIsCinematicMode(true);
              }}
              className="hidden h-9 items-center gap-1.5 border border-app-border bg-app-bg px-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-app-text transition-all hover:border-app-accent hover:text-app-accent shadow-sm md:flex"
              title="Ver Galaxia 3D a pantalla completa"
            >
              <Eye className="size-3.5 text-app-accent" />
              <span className="hidden xl:inline">Modo Cinemático</span>
            </button>

            {/* View Mode Switcher */}
            <div className="flex items-center border border-app-border bg-app-bg p-0.5">
              <button
                onClick={() => setViewMode('3d-galaxy')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  viewMode === '3d-galaxy'
                    ? 'bg-app-accent text-slate-950 font-bold shadow-sm'
                    : 'text-app-muted hover:text-app-text'
                }`}
                title="Vista Galaxia 3D"
              >
                <Orbit className="size-3.5" />
                <span className="hidden xl:inline">Galaxia 3D</span>
              </button>
              <button
                onClick={() => setViewMode('grid-catalog')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  viewMode === 'grid-catalog'
                    ? 'bg-app-accent text-slate-950 font-bold shadow-sm'
                    : 'text-app-muted hover:text-app-text'
                }`}
                title="Vista Catálogo en Cuadrícula"
              >
                <Grid className="size-3.5" />
                <span className="hidden xl:inline">Catálogo</span>
              </button>
            </div>

            {/* Theme Toggle Button */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className="flex h-9 items-center gap-1.5 border border-app-border bg-app-bg px-2.5 font-mono text-[10px] uppercase tracking-wider text-app-text transition-colors hover:border-app-accent hover:text-app-accent"
                title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="size-4 text-amber-400" />
                    <span className="hidden xl:inline">Claro</span>
                  </>
                ) : (
                  <>
                    <Moon className="size-4 text-indigo-500" />
                    <span className="hidden xl:inline">Oscuro</span>
                  </>
                )}
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={() => refresh()}
              className="grid size-9 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
              title="Actualizar Catálogo"
            >
              <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>
      )}

      {!isCinematicMode && (
        <div className="relative z-20 shrink-0 border-b border-app-border bg-app-surface px-3 py-2 xl:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-app-muted" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar producto por nombre o ID..."
              className="h-9 w-full border border-app-border bg-app-bg pl-9 pr-3 font-mono text-xs text-app-text placeholder:text-app-muted/60 focus:border-app-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* KPI Metrics Strip */}
      {!isCinematicMode && (
        <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-app-border bg-app-subtle px-4 py-2 font-mono text-[10px] text-app-muted md:px-6 overflow-x-auto">
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>UNIVERSO 3D: <strong className="text-app-text">{worlds.length} PRODUCTO(S)</strong></span>
            </div>
            <div className="flex items-center gap-2 border-l border-app-border pl-4">
              <Sparkles className="size-3 text-app-accent" />
              <span>FUENTES AGRUPADAS: <strong className="text-app-accent">{totalSources}</strong></span>
            </div>
            <div className="flex items-center gap-2 border-l border-app-border pl-4">
              <Layers className="size-3 text-emerald-400" />
              <span>HERO PNG ALFA: <strong className="text-app-text">{transparentWorlds}/{worlds.length}</strong></span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <span className="border border-app-accent/40 bg-app-accent/10 px-2 py-0.5 text-app-accent">
              MANIFIESTOS REALES
            </span>
            <span className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
              DEDUPE POR PRODUCT ID
            </span>
          </div>
        </div>
      )}

      {/* Main Content View */}
      <main className="relative flex-1 min-h-0 overflow-hidden">
        {error && (
          <div className="absolute top-4 inset-x-4 z-40 mx-auto max-w-xl border border-rose-500/60 bg-rose-950/80 p-3 font-mono text-xs text-rose-200 backdrop-blur">
            {error}
          </div>
        )}

        {viewMode === '3d-galaxy' ? (
          /* 3D GALAXY VIEW */
          <div className="relative h-full w-full">
            {/* Exit Cinematic Button */}
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

            {canvasWorlds.length ? (
              <ProductWorldCanvas worlds={canvasWorlds} onOpenWorld={onOpenWorld} />
            ) : (
              <div className="grid h-full place-items-center bg-grid-faint p-6 text-center">
                <div>
                  <p className="font-mono text-sm uppercase text-app-muted">
                    No se encontraron mundos para "{searchQuery}"
                  </p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-3 border border-app-accent px-4 py-1.5 font-mono text-xs uppercase text-app-accent hover:bg-app-accent hover:text-slate-950"
                  >
                    Ver catálogo completo
                  </button>
                </div>
              </div>
            )}

            {/* Floating Quick World Launcher Card (Bottom Overlay) - Hidden in Cinematic Mode */}
            {!isCinematicMode && featuredWorld && (
              <div className="absolute bottom-6 inset-x-4 z-20 mx-auto hidden max-w-3xl md:block">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border border-app-border bg-app-surface/90 p-4 backdrop-blur-xl shadow-2xl">
                  <div className="flex items-center gap-4">
                    {featuredWorld?.heroUrl && (
                      <div className="relative size-14 shrink-0 overflow-hidden border border-app-border bg-grid-faint">
                        <img
                          src={featuredWorld.heroUrl}
                          alt={featuredWorld.name || featuredWorld.title}
                          className={`h-full w-full ${featuredWorld.heroHasAlpha ? 'object-contain p-1' : 'object-cover'}`}
                        />
                        <span className="absolute bottom-1 right-1 size-2 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="border border-app-accent/60 bg-app-accent/15 px-2 py-0.5 font-mono text-[9px] font-bold text-app-accent uppercase">
                          Destacado
                        </span>
                        <span className="font-mono text-[10px] text-app-muted uppercase">
                          ID: {featuredWorld?.productId || '3D World'}
                        </span>
                      </div>
                      <h2 className="font-display text-base font-bold uppercase tracking-wide text-app-text mt-0.5">
                        {featuredWorld?.name || featuredWorld?.title || 'Universo de Producto'}
                      </h2>
                      <p className="font-mono text-[10px] text-app-muted mt-0.5">
                        {featuredWorld?.sourceCount || 1} fuente(s) deduplicada(s) · manifiesto y medios reales
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                      onClick={() => featuredWorld && onOpenWorld(featuredWorld.productId)}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-2 border border-app-accent bg-app-accent px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-slate-950 transition-all hover:bg-app-accent/90 shadow-lg"
                    >
                      <span>Explorar Universo 3D</span>
                      <ArrowRight className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* GRID CATALOG VIEW */
          <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8 bg-app-bg">
            <div className="mx-auto max-w-6xl space-y-6">
              {/* Filter / Search Bar for Grid */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border border-app-border bg-app-surface p-4">
                <div>
                  <h2 className="font-display text-base font-bold uppercase tracking-wider text-app-text">
                    Catálogo de Productos Fast Track
                  </h2>
                  <p className="font-mono text-xs text-app-muted mt-0.5">
                    Selecciona un producto para abrir su investigación, imágenes, datos y videos disponibles
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filtrar por nombre..."
                    className="w-full border border-app-border bg-app-bg py-2 pl-9 pr-3 font-mono text-xs text-app-text focus:border-app-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Grid Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredWorlds.map((world) => (
                  <div
                    key={world.id}
                    className="group relative flex flex-col border border-app-border bg-app-surface transition-all hover:border-app-accent hover:shadow-2xl"
                  >
                    {/* Hero Image Header */}
                    <div className="relative aspect-video w-full overflow-hidden border-b border-app-border bg-grid-faint">
                      {world.heroUrl ? (
                        <img
                          src={world.heroUrl}
                          alt={world.name || world.title}
                          className={`h-full w-full transition-transform duration-500 group-hover:scale-105 ${world.heroHasAlpha ? 'object-contain p-5' : 'object-cover'}`}
                        />
                      ) : (
                        <div className="grid h-full place-items-center font-mono text-xs text-app-muted">
                          Sin imagen
                        </div>
                      )}

                      <div className="absolute top-3 left-3 flex gap-2">
                        <span className="border border-app-accent bg-app-surface/90 backdrop-blur px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-app-accent">
                          Manifiesto listo
                        </span>
                        <span className="border border-emerald-500 bg-emerald-950/80 backdrop-blur px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                          {world.heroHasAlpha ? 'PNG alfa' : 'Fondo conservado'}
                        </span>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-5 flex flex-col justify-between flex-1 space-y-4">
                      <div>
                        <div className="flex items-center justify-between font-mono text-[10px] text-app-muted">
                          <span>ID: {world.productId}</span>
                           <span>{world.sourceCount || 1} fuente(s)</span>
                        </div>
                        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-app-text mt-1 group-hover:text-app-accent transition-colors">
                          {world.name || world.title}
                        </h3>
                        <p className="font-mono text-xs text-app-muted mt-2 line-clamp-2">
                          Mundo canónico deduplicado por producto, conectado a su manifiesto real de investigación y producción.
                        </p>
                      </div>

                      {/* Micro features list */}
                      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-app-border/60 font-mono text-[10px] text-app-muted">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                          <span>Producto único</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                          <span>Manifiesto real</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                          <span>{world.sourceCount || 1} fuente(s)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                          <span>{world.heroHasAlpha ? 'PNG aislado' : 'Hero original'}</span>
                        </div>
                      </div>

                      {/* Primary Action Button */}
                      <button
                        onClick={() => onOpenWorld(world.productId)}
                        className="flex items-center justify-center gap-2 w-full border border-app-accent bg-app-accent/10 py-3 font-mono text-xs font-bold uppercase tracking-wider text-app-accent transition-all hover:bg-app-accent hover:text-slate-950"
                      >
                        <span>Explorar Universo 3D</span>
                        <ArrowRight className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {isAddProductOpen && (
        <AddProductModal
          job={productImport.job}
          isSubmitting={productImport.isSubmitting}
          isRestoring={productImport.isRestoring}
          isReconnecting={productImport.isReconnecting}
          error={productImport.error}
          onClose={() => setIsAddProductOpen(false)}
          onSubmit={productImport.startImport}
          onRetryConnection={productImport.retryConnection}
          onReset={productImport.reset}
          onOpenWorld={(productId) => {
            setIsAddProductOpen(false);
            onOpenWorld(productId);
          }}
        />
      )}
    </div>
  );
}
