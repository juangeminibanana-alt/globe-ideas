import {
  Braces,
  Check,
  Clipboard,
  Code2,
  File,
  FileJson,
  Files,
  Image as ImageIcon,
  Maximize2,
  Play,
  ScrollText,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FastTrackArtifact, FastTrackManifest, WorldNode } from '../types/fastTrack';

type InspectorTab = 'summary' | 'plain' | 'code' | 'files';

interface ArtifactInspectorProps {
  manifest: FastTrackManifest;
  selectedNode: WorldNode | null;
  onClose: () => void;
  onOpenArtifact: (artifact: FastTrackArtifact) => void;
}

const MAX_PREVIEW_CHARS = 500_000;

const TABS: Array<{ id: InspectorTab; label: string; icon: typeof File }> = [
  { id: 'summary', label: 'Resumen', icon: ScrollText },
  { id: 'plain', label: 'Texto plano', icon: File },
  { id: 'code', label: 'Código / JSON', icon: Code2 },
  { id: 'files', label: 'Archivos', icon: Files },
];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(state: WorldNode['state']) {
  return {
    ready: 'Listo',
    active: 'En proceso',
    pending: 'Pendiente',
    blocked: 'Bloqueado',
    failed: 'Falló',
  }[state ?? 'ready'];
}

function artifactIcon(kind: FastTrackArtifact['kind']) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'video') return Play;
  if (kind === 'json') return FileJson;
  if (kind === 'text' || kind === 'csv' || kind === 'html') return Code2;
  return File;
}

function isTextArtifact(artifact: FastTrackArtifact | undefined) {
  return Boolean(artifact && ['json', 'csv', 'text', 'html'].includes(artifact.kind));
}

export default function ArtifactInspector({
  manifest,
  selectedNode,
  onClose,
  onOpenArtifact,
}: ArtifactInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('summary');
  const [artifactText, setArtifactText] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const artifact = useMemo(
    () => manifest.artifacts.find((item) => item.id === selectedNode?.artifactId),
    [manifest.artifacts, selectedNode?.artifactId],
  );

  useEffect(() => {
    setActiveTab('summary');
    setArtifactText(null);
    setContentError(null);
  }, [selectedNode?.id]);

  useEffect(() => {
    if (!['plain', 'code'].includes(activeTab) || !isTextArtifact(artifact) || artifactText !== null) return;
    const controller = new AbortController();
    setIsContentLoading(true);
    setContentError(null);
    fetch(artifact!.url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`No se pudo abrir el artefacto (${response.status})`);
        const text = await response.text();
        if (text.length > MAX_PREVIEW_CHARS) {
          return `${text.slice(0, MAX_PREVIEW_CHARS)}\n\n[Vista truncada a ${MAX_PREVIEW_CHARS.toLocaleString('es-MX')} caracteres. Abre el archivo para consultar el contenido completo.]`;
        }
        return text;
      })
      .then((text) => setArtifactText(text))
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setContentError(caught instanceof Error ? caught.message : 'No se pudo leer el contenido.');
      })
      .finally(() => setIsContentLoading(false));
    return () => controller.abort();
  }, [activeTab, artifact, artifactText]);

  const fallbackCode = useMemo(
    () => JSON.stringify(selectedNode?.code ?? selectedNode?.metadata ?? selectedNode ?? manifest.run, null, 2),
    [manifest.run, selectedNode],
  );

  const displayText = useMemo(() => {
    if (artifactText !== null && artifact?.kind === 'json') {
      try {
        return JSON.stringify(JSON.parse(artifactText), null, 2);
      } catch {
        return artifactText;
      }
    }
    return artifactText ?? selectedNode?.plainText ?? fallbackCode;
  }, [artifact?.kind, artifactText, fallbackCode, selectedNode?.plainText]);

  const copyContent = async () => {
    await navigator.clipboard.writeText(displayText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const originalMediaUrl = artifact?.kind === 'image' || artifact?.kind === 'video'
    ? artifact.url
    : selectedNode?.thumbnailUrl;
  const previewMediaUrl = artifact?.kind === 'image'
    ? artifact.displayUrl ?? artifact.url
    : artifact?.kind === 'video'
      ? artifact.url
      : selectedNode?.thumbnailUrl;
  const hasTransparentPreview = artifact?.backgroundMode === 'transparent'
    || Boolean(selectedNode?.transparentUrl);

  return (
    <aside className="inspector-panel flex h-full min-h-0 flex-col border-l border-app-border bg-app-surface" aria-label="Inspector Fast Track">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b border-app-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center border border-product-accent/70 text-product-accent">
            {selectedNode?.kind === 'video' ? <Play className="size-4" /> : <Braces className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-semibold uppercase tracking-[0.08em] text-app-text">
              {selectedNode?.label ?? 'Resumen de la ejecución'}
            </p>
            <p className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.16em] text-app-muted">
              {artifact?.label ?? manifest.run.id}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center border border-app-border text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
          aria-label="Cerrar selección"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="inspector-scroll min-h-0 flex-1 overflow-y-auto">
        <section className="grid gap-4 border-b border-app-border p-4 sm:grid-cols-[minmax(180px,0.9fr)_1.1fr]">
          <div className={`relative min-h-44 overflow-hidden border border-app-border ${
            hasTransparentPreview ? 'bg-grid-faint' : 'bg-app-bg'
          }`}>
            {artifact?.kind === 'video' && previewMediaUrl ? (
              <video
                src={previewMediaUrl}
                poster={selectedNode?.thumbnailUrl}
                controls
                preload="metadata"
                playsInline
                className="h-full min-h-44 w-full object-contain"
              />
            ) : previewMediaUrl ? (
              <a
                href={originalMediaUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir imagen original"
                className="group relative block h-full min-h-44 w-full"
              >
                <img
                  src={previewMediaUrl}
                  alt={selectedNode?.imageAlt ?? selectedNode?.label ?? manifest.product.title}
                  className="h-full min-h-44 w-full object-contain"
                />
                {hasTransparentPreview && (
                  <span className="absolute left-2 top-2 border border-app-accent/70 bg-app-bg/90 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-app-accent backdrop-blur">
                    PNG con alfa
                  </span>
                )}
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 border border-app-border bg-app-bg/90 px-2 py-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-app-muted backdrop-blur transition-colors group-hover:border-app-accent group-hover:text-app-accent">
                  <Maximize2 className="size-3" /> Abrir original
                </span>
              </a>
            ) : (
              <div className="grid h-full min-h-44 place-items-center bg-grid-faint text-app-border">
                <Braces className="size-12" />
              </div>
            )}
          </div>

          <dl className="grid content-start gap-3 text-xs">
            <Fact label="Dato extraído" value={selectedNode?.summary ?? manifest.product.title} />
            <Fact label="Fuente" value={selectedNode?.evidence ?? artifact?.label ?? 'Fast Track'} />
            <Fact
              label="Estado"
              value={statusLabel(selectedNode?.state)}
              tone={selectedNode?.state === 'pending' ? 'warm' : 'cool'}
            />
            <Fact
              label="Muestra de reseñas"
              value={`${manifest.reviews.capturedCount} capturadas de ${manifest.reviews.total}`}
            />
          </dl>
        </section>

        <nav className="sticky top-0 z-10 flex overflow-x-auto border-b border-app-border bg-app-surface/96 px-2 backdrop-blur" role="tablist">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${
                  activeTab === tab.id
                    ? 'border-app-accent text-app-accent'
                    : 'border-transparent text-app-muted hover:text-app-text'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4">
          {activeTab === 'summary' && (
            <SummaryPanel manifest={manifest} node={selectedNode} artifact={artifact} />
          )}

          {activeTab === 'plain' && (
            <TextPanel
              title="Contenido en texto plano"
              content={displayText}
              loading={isContentLoading}
              error={contentError}
              onCopy={copyContent}
              copied={copied}
            />
          )}

          {activeTab === 'code' && (
            <CodePanel
              content={displayText}
              loading={isContentLoading}
              error={contentError}
              onCopy={copyContent}
              copied={copied}
            />
          )}

          {activeTab === 'files' && (
            <FilesPanel artifacts={manifest.artifacts} onOpenArtifact={onOpenArtifact} />
          )}
        </div>
      </div>
    </aside>
  );
}

function Fact({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'cool' | 'warm' }) {
  const toneClass = tone === 'cool' ? 'text-app-accent' : tone === 'warm' ? 'text-product-accent' : 'text-app-text';
  return (
    <div>
      <dt className="font-mono text-[8px] uppercase tracking-[0.14em] text-app-muted">{label}</dt>
      <dd className={`mt-1 leading-relaxed ${toneClass}`}>{value}</dd>
    </div>
  );
}

function SummaryPanel({
  manifest,
  node,
  artifact,
}: {
  manifest: FastTrackManifest;
  node: WorldNode | null;
  artifact?: FastTrackArtifact;
}) {
  const entries = Object.entries(node?.metadata ?? {}).slice(0, 8);
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Lectura del nodo</SectionTitle>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          {node?.summary ?? `Investigación y producción Fast Track para ${manifest.product.title}.`}
        </p>
      </div>

      <div className="grid gap-px border border-app-border bg-app-border sm:grid-cols-2">
        <MiniMetric label="Tipo" value={node?.kind ?? artifact?.kind ?? 'run'} />
        <MiniMetric label="Etapa" value={node?.category ?? manifest.run.stage ?? manifest.run.status} />
        <MiniMetric label="Tamaño" value={artifact ? formatBytes(artifact.size) : '—'} />
        <MiniMetric label="Estado" value={statusLabel(node?.state)} />
      </div>

      {entries.length > 0 && (
        <div>
          <SectionTitle>Metadatos</SectionTitle>
          <dl className="mt-2 divide-y divide-app-border border-y border-app-border">
            {entries.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(90px,0.7fr)_1.3fr] gap-3 py-2 text-xs">
                <dt className="font-mono text-[9px] uppercase text-app-muted">{key}</dt>
                <dd className="break-words text-app-text">{formatMetadataValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {manifest.reviews.sample.length > 0 && node?.kind === 'review' && (
        <div>
          <SectionTitle>Reseñas capturadas · {manifest.reviews.capturedCount}/{manifest.reviews.total}</SectionTitle>
          <div className="mt-2 space-y-2">
            {manifest.reviews.sample.map((review, index) => (
              <blockquote key={review.id ?? index} className="border-l border-app-accent bg-app-bg/60 px-3 py-2 text-xs leading-relaxed text-app-muted">
                <span className="text-app-accent">{'★'.repeat(Math.max(0, review.rating ?? 0))}</span>
                <p className="mt-1">{review.text}</p>
              </blockquote>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[dato estructurado]';
    }
  }
  return String(value);
}

function TextPanel({
  title,
  content,
  loading,
  error,
  onCopy,
  copied,
}: {
  title: string;
  content: string;
  loading: boolean;
  error: string | null;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div>
      <PanelToolbar title={title} onCopy={onCopy} copied={copied} />
      {loading ? <PanelMessage>Cargando contenido…</PanelMessage> : error ? <PanelMessage>{error}</PanelMessage> : (
        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap border border-app-border bg-app-bg p-4 font-mono text-[11px] leading-5 text-app-muted">
          {content}
        </pre>
      )}
    </div>
  );
}

function CodePanel({
  content,
  loading,
  error,
  onCopy,
  copied,
}: {
  content: string;
  loading: boolean;
  error: string | null;
  onCopy: () => void;
  copied: boolean;
}) {
  const lines = content.split('\n');
  return (
    <div>
      <PanelToolbar title="Fuente / JSON" onCopy={onCopy} copied={copied} />
      {loading ? <PanelMessage>Cargando código…</PanelMessage> : error ? <PanelMessage>{error}</PanelMessage> : (
        <div className="code-preview max-h-[520px] overflow-auto border border-app-border bg-app-bg py-3 font-mono text-[11px] leading-5">
          {lines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 12)}`} className="grid min-w-max grid-cols-[52px_1fr] px-2">
              <span className="select-none border-r border-app-border pr-3 text-right text-app-border">{index + 1}</span>
              <span className="whitespace-pre px-3 text-[#b7e6c8]">{line || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesPanel({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: FastTrackArtifact[];
  onOpenArtifact: (artifact: FastTrackArtifact) => void;
}) {
  return (
    <div>
      <SectionTitle>Artefactos generados · {artifacts.length}</SectionTitle>
      <div className="mt-3 overflow-x-auto border-y border-app-border">
        <table className="w-full min-w-[540px] border-collapse text-left">
          <thead className="font-mono text-[8px] uppercase tracking-[0.12em] text-app-muted">
            <tr className="border-b border-app-border">
              <th className="px-2 py-2 font-normal">Nombre</th>
              <th className="px-2 py-2 font-normal">Tipo</th>
              <th className="px-2 py-2 font-normal">Tamaño</th>
              <th className="px-2 py-2 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((artifact) => {
              const Icon = artifactIcon(artifact.kind);
              return (
                <tr key={artifact.id} className="border-b border-app-border/70 text-xs last:border-b-0">
                  <td className="max-w-64 px-2 py-2.5">
                    <button
                      onClick={() => onOpenArtifact(artifact)}
                      className="flex max-w-full items-center gap-2 text-left text-app-text transition-colors hover:text-app-accent"
                    >
                      <Icon className="size-3.5 shrink-0 text-app-accent" />
                      <span className="truncate">{artifact.label}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-[9px] uppercase text-app-muted">{artifact.kind}</td>
                  <td className="px-2 py-2.5 font-mono text-[9px] text-app-muted">{formatBytes(artifact.size)}</td>
                  <td className="px-2 py-2.5 font-mono text-[9px] uppercase text-[#80e6b0]">● Listo</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelToolbar({ title, onCopy, copied }: { title: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <SectionTitle>{title}</SectionTitle>
      <button onClick={onCopy} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-app-accent hover:text-app-text">
        {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <div className="border border-app-border bg-app-bg p-5 font-mono text-xs text-app-muted">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-app-muted">{children}</h3>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app-bg px-3 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-app-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-[10px] uppercase text-app-text">{value}</p>
    </div>
  );
}
