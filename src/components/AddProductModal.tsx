import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  Image as ImageIcon,
  Images,
  Link2,
  LoaderCircle,
  Orbit,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ProductImportJob, ProductImportStage } from '../types/fastTrack';
import { validateTikTokUrl } from '../hooks/useProductImport';

const IMPORT_STEPS: Array<{ id: ProductImportStage; label: string }> = [
  { id: 'resolve-source', label: 'Resolver enlace TikTok' },
  { id: 'extract-product', label: 'Extraer datos e imágenes' },
  { id: 'clean-images', label: 'Organizar y validar evidencias' },
  { id: 'research-ready', label: 'Publicar investigación inicial' },
  { id: 'build-360-coverage', label: 'Completar cobertura 360°' },
  { id: 'generate-product-bible', label: 'Generar Product Bible' },
  { id: 'generate-storyboard', label: 'Generar storyboard' },
  { id: 'select-seven-references', label: 'Validar 7 referencias' },
  { id: 'generate-grok-video', label: 'Generar video con Grok' },
  { id: 'upscale-video', label: 'Preparar entrega 1080p' },
  { id: 'publish-world', label: 'Actualizar mundo de producto' },
];

const STATUS_LABELS: Record<ProductImportJob['status'], string> = {
  queued: 'En cola',
  running: 'Procesando',
  'needs-input': 'Esperando a Codex',
  blocked: 'Proceso bloqueado',
  failed: 'Proceso fallido',
  complete: 'Mundo listo',
};

interface AddProductModalProps {
  job: ProductImportJob | null;
  isSubmitting: boolean;
  isRestoring: boolean;
  isReconnecting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (sourceUrl: string) => Promise<ProductImportJob | null>;
  onRetryConnection: () => void;
  onReset: () => void;
  onOpenWorld: (productId: string) => void;
}

type StepState = 'complete' | 'active' | 'waiting' | 'pending' | 'failed';

function stepState(job: ProductImportJob, index: number, currentIndex: number): StepState {
  if (job.status === 'complete') return 'complete';
  if ((job.status === 'failed' || job.status === 'blocked') && index === currentIndex) return 'failed';
  if (index < currentIndex) return 'complete';
  if (job.status === 'needs-input' && index === currentIndex) return 'waiting';
  if (index === currentIndex) return 'active';
  return 'pending';
}

function statusTone(job: ProductImportJob): string {
  if (job.status === 'complete') return 'text-emerald-400';
  if (job.status === 'failed' || job.status === 'blocked') return 'text-rose-300';
  if (job.status === 'needs-input') return 'text-amber-300';
  return 'text-app-accent';
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'complete') return <CheckCircle2 className="size-4 text-emerald-400" />;
  if (state === 'failed') return <AlertTriangle className="size-4 text-rose-300" />;
  if (state === 'waiting') return <AlertTriangle className="size-4 text-amber-300" />;
  if (state === 'active') return <LoaderCircle className="size-4 animate-spin text-app-accent" />;
  return <Circle className="size-4 text-app-border" />;
}

export default function AddProductModal({
  job,
  isSubmitting,
  isRestoring,
  isReconnecting,
  error,
  onClose,
  onSubmit,
  onRetryConnection,
  onReset,
  onOpenWorld,
}: AddProductModalProps) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(job ? 'close' : 'input');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTarget = initialFocusRef.current === 'close' ? closeRef.current : inputRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const currentStepIndex = useMemo(() => {
    if (!job) return 0;
    return Math.max(0, IMPORT_STEPS.findIndex((step) => step.id === job.stage));
  }, [job]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      const normalizedUrl = validateTikTokUrl(sourceUrl);
      await onSubmit(normalizedUrl);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo iniciar la extracción.');
    }
  };

  const startAnother = () => {
    onReset();
    setSourceUrl('');
    setFormError(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const progress = job?.progress;
  const hasDeterminateProgress = typeof progress === 'number' && Number.isFinite(progress);
  const displayError = formError ?? error ?? job?.error?.message ?? null;
  const coverage = job?.gates?.coverage360;
  const references = job?.gates?.videoReferences;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-product-title"
        aria-describedby="add-product-description"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden border border-app-border bg-app-surface text-app-text shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-app-border bg-app-subtle px-4 py-4 sm:px-6">
          <div className="flex min-w-0 gap-3">
            <div className="grid size-10 shrink-0 place-items-center border border-app-accent/60 bg-app-accent/10 text-app-accent">
              <Plus className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 id="add-product-title" className="font-display text-lg font-bold uppercase tracking-[0.06em] sm:text-xl">
                Agregar nuevo producto
              </h2>
              <p id="add-product-description" className="mt-1 font-mono text-[10px] leading-5 text-app-muted sm:text-xs">
                Pega el enlace de TikTok. El producto aparecerá en la galaxia cuando existan datos e imágenes reales.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
            aria-label="Cerrar ventana de nuevo producto"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!job && !isRestoring ? (
            <form onSubmit={submit} className="space-y-6 p-4 sm:p-6">
              <div>
                <label htmlFor="tiktok-product-url" className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-text">
                  Enlace de producto TikTok
                </label>
                <div className="relative mt-2">
                  <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted" />
                  <input
                    ref={inputRef}
                    id="tiktok-product-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    required
                    value={sourceUrl}
                    onChange={(event) => {
                      setSourceUrl(event.target.value);
                      setFormError(null);
                    }}
                    placeholder="https://vt.tiktok.com/..."
                    className="h-12 w-full border border-app-border bg-app-bg pl-10 pr-4 font-mono text-sm text-app-text outline-none transition-colors placeholder:text-app-muted/50 focus:border-app-accent"
                    aria-invalid={Boolean(formError)}
                    aria-describedby={formError ? 'tiktok-url-error' : undefined}
                  />
                </div>
                {formError && (
                  <p id="tiktok-url-error" role="alert" className="mt-2 flex items-start gap-2 font-mono text-[10px] leading-5 text-rose-300">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {formError}
                  </p>
                )}
              </div>

              <div className="grid gap-px border border-app-border bg-app-border sm:grid-cols-3">
                <div className="bg-app-bg p-4">
                  <Orbit className="size-5 text-app-accent" />
                  <p className="mt-3 font-mono text-[10px] font-bold uppercase text-app-text">Cobertura 360°</p>
                  <p className="mt-1 text-xs leading-5 text-app-muted">Ocho sectores visuales alrededor del producto, con procedencia declarada.</p>
                </div>
                <div className="bg-app-bg p-4">
                  <ImageIcon className="size-5 text-app-accent" />
                  <p className="mt-3 font-mono text-[10px] font-bold uppercase text-app-text">GPT Image 2</p>
                  <p className="mt-1 text-xs leading-5 text-app-muted">Product Bible y storyboard con evidencia visual.</p>
                </div>
                <div className="bg-app-bg p-4">
                  <Images className="size-5 text-app-accent" />
                  <p className="mt-3 font-mono text-[10px] font-bold uppercase text-app-text">7 referencias</p>
                  <p className="mt-1 text-xs leading-5 text-app-muted">Bible, storyboard y cinco ángulos para Grok.</p>
                </div>
              </div>

              {error && !formError && (
                <p role="alert" className="border border-rose-500/50 bg-rose-950/30 p-3 font-mono text-xs text-rose-200">
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-app-border pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 border border-app-border px-5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-app-muted transition-colors hover:text-app-text"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !sourceUrl.trim()}
                  className="flex h-11 items-center justify-center gap-2 border border-app-accent bg-app-accent px-5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {isSubmitting ? 'Iniciando extracción' : 'Agregar producto'}
                </button>
              </div>
            </form>
          ) : isRestoring && !job ? (
            <div className="grid min-h-80 place-items-center p-8 text-center">
              <div>
                <LoaderCircle className="mx-auto size-8 animate-spin text-app-accent" />
                <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-app-text">Reconectando con la extracción</p>
                <p className="mt-2 text-xs text-app-muted">El proceso continúa aunque hayas recargado la aplicación.</p>
              </div>
            </div>
          ) : job ? (
            <div className="space-y-5 p-4 sm:p-6">
              <section className="border border-app-border bg-app-bg p-4" aria-live="polite">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(job)}`}>
                      {STATUS_LABELS[job.status]}
                    </p>
                    <p className="mt-2 truncate font-mono text-xs text-app-text" title={job.sourceUrl}>
                      {job.sourceUrl || 'Enlace TikTok validado'}
                    </p>
                  </div>
                  {job.productId && (
                    <span className="border border-app-border px-2 py-1 font-mono text-[9px] text-app-muted">
                      ID {job.productId}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase text-app-muted">
                    <span>{job.message ?? IMPORT_STEPS[currentStepIndex]?.label ?? 'Procesando producto'}</span>
                    {hasDeterminateProgress && <span>{Math.round(progress)}%</span>}
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Progreso de extracción del producto"
                    aria-valuemin={hasDeterminateProgress ? 0 : undefined}
                    aria-valuemax={hasDeterminateProgress ? 100 : undefined}
                    aria-valuenow={hasDeterminateProgress ? Math.round(progress) : undefined}
                    className="h-1.5 overflow-hidden bg-app-subtle"
                  >
                    {hasDeterminateProgress ? (
                      <div className="h-full bg-app-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse bg-app-accent" />
                    )}
                  </div>
                  {!hasDeterminateProgress && job.status !== 'complete' && (
                    <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-app-muted">
                      Esta etapa no reporta porcentaje; se mostrará el siguiente evento real.
                    </p>
                  )}
                </div>
              </section>

              {isReconnecting && (
                <div className="flex flex-col gap-3 border border-amber-500/50 bg-amber-950/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2 font-mono text-[10px] leading-5 text-amber-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Sin conexión temporal. El servidor puede seguir procesando el producto.
                  </p>
                  <button type="button" onClick={onRetryConnection} className="flex shrink-0 items-center justify-center gap-2 border border-amber-400/60 px-3 py-2 font-mono text-[9px] uppercase text-amber-200">
                    <RefreshCw className="size-3.5" /> Reconectar
                  </button>
                </div>
              )}

              {displayError && !isReconnecting && (
                <div role="alert" className="border border-rose-500/50 bg-rose-950/30 p-3 font-mono text-[10px] leading-5 text-rose-200">
                  {displayError}
                </div>
              )}

              <section>
                <h3 className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-app-muted">Etapas verificables</h3>
                <div className="mt-3 grid gap-px border border-app-border bg-app-border sm:grid-cols-2">
                  {IMPORT_STEPS.map((step, index) => {
                    const state = stepState(job, index, currentStepIndex);
                    return (
                      <div key={step.id} className={`flex items-center gap-3 bg-app-bg px-3 py-2.5 ${state === 'pending' ? 'opacity-50' : ''}`}>
                        <StepIcon state={state} />
                        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-app-text">{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {(coverage || references) && (
                <section className="grid gap-3 sm:grid-cols-2">
                  {coverage && (
                    <div className="border border-app-border bg-app-bg p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-[9px] font-bold uppercase text-app-muted">Cobertura angular</p>
                        {coverage.ready && <Check className="size-4 text-emerald-400" />}
                      </div>
                      <p className="mt-2 font-display text-xl font-bold text-app-text">
                        {coverage.usableFullProductAngles}/{coverage.requiredAngles}
                      </p>
                      <p className="mt-1 text-xs text-app-muted">vistas completas, distintas y utilizables</p>
                      {coverage.missingAngles && coverage.missingAngles.length > 0 && (
                        <p className="mt-2 font-mono text-[9px] text-amber-300">Faltan: {coverage.missingAngles.join(', ')}</p>
                      )}
                    </div>
                  )}
                  {references && (
                    <div className="border border-app-border bg-app-bg p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-[9px] font-bold uppercase text-app-muted">Paquete para Grok</p>
                        {references.ready && <Check className="size-4 text-emerald-400" />}
                      </div>
                      <p className="mt-2 font-display text-xl font-bold text-app-text">{references.total}/7</p>
                      <p className="mt-1 font-mono text-[9px] leading-5 text-app-muted">
                        Bible {references.productBible}/1 · Storyboard {references.storyboard}/1 · Ángulos {references.fullProductAngles}/5
                      </p>
                    </div>
                  )}
                </section>
              )}

              {job.status === 'needs-input' && (
                <p className="border border-amber-500/50 bg-amber-950/20 p-3 font-mono text-[10px] leading-5 text-amber-200">
                  Esta etapa usa generación integrada de Codex y no puede ejecutarse dentro de Express. El trabajo permanece guardado y avanzará automáticamente cuando aparezcan los artefactos aprobados.
                </p>
              )}

              {currentStepIndex >= IMPORT_STEPS.findIndex((step) => step.id === 'research-ready') && job.status !== 'complete' && (
                <p className="border border-emerald-500/40 bg-emerald-950/20 p-3 font-mono text-[10px] leading-5 text-emerald-200">
                  La investigación inicial ya está disponible en la galaxia mientras continúa la producción visual.
                </p>
              )}

              {job.mergedIntoExistingWorld && (
                <p className="border border-emerald-500/40 bg-emerald-950/20 p-3 font-mono text-[10px] leading-5 text-emerald-200">
                  El producto ya existía: los resultados se agruparon dentro del mismo mundo, sin duplicarlo.
                </p>
              )}

              <footer className="flex flex-col-reverse gap-2 border-t border-app-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-[9px] leading-4 text-app-muted">
                  {job.status === 'needs-input'
                    ? 'Puedes cerrar esta ventana. El servidor conservará el punto exacto de reanudación.'
                    : 'Puedes cerrar esta ventana. El proceso continuará en el servidor.'}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {(job.status === 'complete' || job.status === 'failed') && (
                    <button type="button" onClick={startAnother} className="h-10 border border-app-border px-4 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-app-muted hover:text-app-text">
                      Agregar otro
                    </button>
                  )}
                  {job.productId && currentStepIndex >= IMPORT_STEPS.findIndex((step) => step.id === 'research-ready') && (
                    <button
                      type="button"
                      onClick={() => onOpenWorld(job.productId!)}
                      className="flex h-10 items-center justify-center gap-2 border border-app-accent bg-app-accent px-4 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-slate-950"
                    >
                      Abrir mundo <ExternalLink className="size-3.5" />
                    </button>
                  )}
                </div>
              </footer>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
