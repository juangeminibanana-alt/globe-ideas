import { useEffect, useMemo, useState } from 'react';
import { X, Images, FileText, Maximize2, Download, ExternalLink, Check, ScanSearch } from 'lucide-react';
import type { FastTrackArtifact, FastTrackManifest, WorldNode } from '../types/fastTrack';

interface EvidenceGalleryModalProps {
  manifest: FastTrackManifest;
  onClose: () => void;
  onSelectNode?: (node: WorldNode) => void;
}

type EvidenceCategory = 'all' | 'images' | 'bible' | 'video' | 'data';

function categoryForArtifact(artifact: FastTrackArtifact): Exclude<EvidenceCategory, 'all'> {
  const role = `${artifact.role ?? ''} ${artifact.label}`.toLowerCase();
  if (artifact.kind === 'video') return 'video';
  if (artifact.stage === 'bible' || role.includes('bible')) return 'bible';
  if (artifact.kind === 'image') return 'images';
  return 'data';
}

export default function EvidenceGalleryModal({
  manifest,
  onClose,
  onSelectNode,
}: EvidenceGalleryModalProps) {
  const [activeCategory, setActiveCategory] = useState<EvidenceCategory>('all');
  const [activeLightboxArtifact, setActiveLightboxArtifact] = useState<FastTrackArtifact | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const galleryItems = useMemo(() => manifest.artifacts.map((artifact, index) => ({
    ...artifact,
    category: categoryForArtifact(artifact),
    displayLabel: artifact.label || `Evidencia #${index + 1}`,
  })), [manifest.artifacts]);
  const counts = useMemo(() => galleryItems.reduce<Record<EvidenceCategory, number>>((result, item) => {
    result.all += 1;
    result[item.category] += 1;
    return result;
  }, { all: 0, images: 0, bible: 0, video: 0, data: 0 }), [galleryItems]);
  const totalCount = galleryItems.length;
  const filteredItems = galleryItems.filter((item) => {
    if (activeCategory === 'all') return true;
    return item.category === activeCategory;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeLightboxArtifact) setActiveLightboxArtifact(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeLightboxArtifact, onClose]);

  const handleCopyUrl = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.href).href);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch (error) {
      console.error('No se pudo copiar la URL de la evidencia:', error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-xl animate-fadeIn sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-gallery-title"
    >
      <div
        className="relative flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-app-border bg-app-surface text-app-text shadow-[0_25px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-app-border bg-app-subtle px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center border border-app-accent/60 bg-app-accent/10 text-app-accent">
              <Images className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="evidence-gallery-title" className="font-display text-lg font-bold uppercase tracking-wider text-app-text">
                  Galería de Evidencias Extraídas
                </h2>
                <span className="border border-app-accent/60 bg-app-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-app-accent">
                  {totalCount} ARCHIVOS
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-app-muted">
                {manifest.product.title} · Fotografías principales, Variantes, Fichas Técnicas & Video
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="grid size-9 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-text"
            aria-label="Cerrar Galería"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Navigation Tabs */}
        <nav className="flex shrink-0 border-b border-app-border bg-app-surface px-4 overflow-x-auto">
          <CategoryTab
            label="Todas las Evidencias"
            count={counts.all}
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          />
          <CategoryTab
            label="Imágenes"
            count={counts.images}
            active={activeCategory === 'images'}
            disabled={counts.images === 0}
            onClick={() => setActiveCategory('images')}
          />
          <CategoryTab
            label="Product Bible"
            count={counts.bible}
            active={activeCategory === 'bible'}
            disabled={counts.bible === 0}
            onClick={() => setActiveCategory('bible')}
          />
          <CategoryTab
            label="Datos & Documentos"
            count={counts.data}
            active={activeCategory === 'data'}
            disabled={counts.data === 0}
            onClick={() => setActiveCategory('data')}
          />
          <CategoryTab
            label="Videos"
            count={counts.video}
            active={activeCategory === 'video'}
            disabled={counts.video === 0}
            onClick={() => setActiveCategory('video')}
          />
        </nav>

        {/* Gallery Grid Container */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 bg-app-bg">
          {filteredItems.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filteredItems.map((item) => {
              const isVideo = item.kind === 'video';
              const isImage = item.kind === 'image';
              const isTransparent = item.backgroundMode === 'transparent' || Boolean(item.transparentUrl);
              const previewUrl = item.transparentUrl || item.displayUrl || item.url;
              const linkedNode = manifest.nodes.find((node) => node.artifactId === item.id);

              return (
                <div
                  key={item.id}
                  className="group relative flex flex-col border border-app-border bg-app-surface transition-all hover:border-app-accent hover:shadow-lg"
                >
                  {/* Media Preview Thumbnail */}
                  <div className={`relative aspect-video w-full overflow-hidden border-b border-app-border ${
                    isTransparent ? 'bg-grid-faint' : 'bg-black/40'
                  }`}>
                    {isVideo ? (
                      <video
                        src={item.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain"
                      />
                    ) : isImage ? (
                      <img
                        src={previewUrl}
                        alt={item.displayLabel}
                        className={`h-full w-full transition-transform duration-500 group-hover:scale-105 ${isTransparent ? 'object-contain p-3' : 'object-cover'}`}
                      />
                    ) : (
                      <div className="grid h-full place-items-center bg-grid-faint p-5 text-center">
                        <div>
                          <FileText className="mx-auto size-8 text-app-accent" />
                          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-app-muted">{item.kind}</p>
                        </div>
                      </div>
                    )}

                    {/* Badges */}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <span className="border border-app-border bg-app-bg/90 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-app-muted backdrop-blur">
                        {item.kind}
                      </span>
                      {isTransparent && (
                        <span className="border border-app-accent/80 bg-app-accent/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-app-accent backdrop-blur">
                          PNG Alfa
                        </span>
                      )}
                    </div>

                    {/* Quick View Button */}
                    <button
                      onClick={() => setActiveLightboxArtifact(item)}
                      className="absolute bottom-2 right-2 flex items-center gap-1 border border-app-border bg-app-bg/90 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-app-text backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity hover:border-app-accent hover:text-app-accent"
                    >
                      <Maximize2 className="size-3" /> Ampliar
                    </button>
                  </div>

                  {/* Card Content Info */}
                  <div className="p-3 flex flex-col justify-between flex-1">
                    <div>
                      <p className="font-mono text-xs font-semibold text-app-text line-clamp-1">
                        {item.displayLabel}
                      </p>
                      <p className="mt-1 font-mono text-[9px] text-app-muted">
                        Fuente: <span className="text-app-text">{item.role || 'Fast Track Archive'}</span>
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-app-border/60 pt-2 font-mono text-[9px] text-app-muted">
                      <span>{(item.size / 1024).toFixed(0)} KB</span>
                      <div className="flex items-center gap-3">
                        {linkedNode && onSelectNode ? (
                          <button
                            onClick={() => {
                              onSelectNode(linkedNode);
                              onClose();
                            }}
                            className="flex items-center gap-1 text-app-text hover:text-app-accent"
                          >
                            <ScanSearch className="size-3" /> Inspeccionar
                          </button>
                        ) : null}
                        <button
                          onClick={() => void handleCopyUrl(item.url, item.id)}
                          className="flex items-center gap-1 text-app-accent hover:text-app-text"
                        >
                          {copiedId === item.id ? <Check className="size-3 text-emerald-400" /> : <ExternalLink className="size-3" />}
                          {copiedId === item.id ? 'Copiado' : 'Link'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div> : (
            <div className="grid min-h-64 place-items-center border border-dashed border-app-border bg-app-surface p-8 text-center">
              <div>
                <FileText className="mx-auto size-8 text-app-muted" />
                <p className="mt-3 font-mono text-xs uppercase tracking-wider text-app-muted">No hay artefactos en esta categoría</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <footer className="flex shrink-0 items-center justify-between border-t border-app-border bg-app-subtle px-5 py-3 font-mono text-[10px] text-app-muted">
          <span>
            Mostrando <strong>{filteredItems.length}</strong> de <strong>{totalCount}</strong> evidencias procesadas
          </span>
          <button
            onClick={onClose}
            className="border border-app-border bg-app-surface px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-app-text transition-colors hover:border-app-accent hover:text-app-accent"
          >
            Cerrar Galería
          </button>
        </footer>
      </div>

      {/* Lightbox / High-Res Preview Modal */}
      {activeLightboxArtifact && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-2xl"
          onClick={(event) => {
            event.stopPropagation();
            setActiveLightboxArtifact(null);
          }}
        >
          <div
            className="relative flex max-h-[90vh] max-w-4xl flex-col border border-app-border bg-app-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 border-b border-app-border pb-2">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-app-text">
                {activeLightboxArtifact.label}
              </h3>
              <button
                onClick={() => setActiveLightboxArtifact(null)}
                className="p-1 border border-app-border text-app-muted hover:text-app-text"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-hidden grid place-items-center bg-black/60 border border-app-border">
              {activeLightboxArtifact.kind === 'video' ? (
                <video
                  src={activeLightboxArtifact.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[65vh] w-auto object-contain"
                />
              ) : activeLightboxArtifact.kind === 'image' ? (
                <img
                  src={activeLightboxArtifact.transparentUrl || activeLightboxArtifact.displayUrl || activeLightboxArtifact.url}
                  alt={activeLightboxArtifact.label}
                  className="max-h-[65vh] w-auto object-contain"
                />
              ) : (
                <div className="grid min-h-72 min-w-[min(34rem,80vw)] place-items-center p-8 text-center">
                  <div>
                    <FileText className="mx-auto size-12 text-app-accent" />
                    <p className="mt-4 font-mono text-xs uppercase tracking-wider text-app-text">{activeLightboxArtifact.kind}</p>
                    <p className="mt-2 text-xs text-app-muted">Abre el archivo original para revisar su contenido completo.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-app-muted">
              <span>MIME: {activeLightboxArtifact.mimeType}</span>
              <a
                href={activeLightboxArtifact.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 border border-app-accent px-3 py-1 text-app-accent hover:bg-app-accent hover:text-slate-950 transition-colors"
              >
                <Download className="size-3" /> Abrir / Descargar Original
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryTab({
  label,
  count,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? 'border-app-accent text-app-accent bg-app-accent/5'
          : disabled
            ? 'cursor-not-allowed border-transparent text-app-muted/35'
          : 'border-transparent text-app-muted hover:text-app-text'
      }`}
    >
      <span>{label}</span>
      <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
        active ? 'bg-app-accent text-slate-950' : 'bg-app-border/80 text-app-muted'
      }`}>
        {count}
      </span>
    </button>
  );
}
