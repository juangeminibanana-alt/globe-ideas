import React from 'react';
import { Filter, Sparkles, Check, Flame, Box, ShieldCheck, Zap, ChevronDown } from 'lucide-react';
import type { WorldNode } from '../types/fastTrack';

export type NarrativeAngle = 'all' | 'problema-solucion' | 'estilo-vida' | 'unboxing' | 'comparativa' | 'demostracion';

export interface NarrativeAngleOption {
  id: NarrativeAngle;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NarrativeAngleFilterProps {
  activeAngle: NarrativeAngle;
  onChangeAngle: (angle: NarrativeAngle) => void;
  nodeCounts?: Partial<Record<NarrativeAngle, number>>;
}

export const NARRATIVE_ANGLES: NarrativeAngleOption[] = [
  { id: 'all', label: 'Toda la evidencia', icon: Sparkles },
  { id: 'problema-solucion', label: 'Problema - Solución', icon: Flame },
  { id: 'estilo-vida', label: 'Estilo de Vida & Moda', icon: Zap },
  { id: 'unboxing', label: 'Unboxing & Empaque', icon: Box },
  { id: 'comparativa', label: 'Comparativa de Calidad', icon: ShieldCheck },
  { id: 'demostracion', label: 'Demostración Técnica', icon: Check },
];

export function matchesNarrativeAngle(node: WorldNode, angle: NarrativeAngle) {
  if (angle === 'all') return true;
  const text = `${node.label} ${node.summary} ${node.evidence ?? ''} ${node.kind ?? ''}`.toLowerCase();
  if (angle === 'problema-solucion') {
    return node.category === 'research' || node.kind === 'review' || /problema|soluci[oó]n|dolor|reseña|necesidad/.test(text);
  }
  if (angle === 'estilo-vida') {
    return node.category === 'images' || /estilo|look|uso|modelo|lifestyle|galer[ií]a/.test(text);
  }
  if (angle === 'unboxing') {
    return /unboxing|empaque|caja|paquete|env[ií]o|sizechart|medida/.test(text);
  }
  if (angle === 'comparativa') {
    return node.category === 'data' || /compar|material|variante|precio|calidad|ficha|dato/.test(text);
  }
  return node.category === 'video' || node.category === 'bible' || /demo|t[eé]cnica|video|bible|detalle/.test(text);
}

export default function NarrativeAngleFilter({
  activeAngle,
  onChangeAngle,
  nodeCounts,
}: NarrativeAngleFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const activeLabel = NARRATIVE_ANGLES.find((angle) => angle.id === activeAngle)?.label;

  return (
    <div className="absolute top-14 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-col gap-2 md:max-w-xs">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 border border-app-border bg-app-surface/90 px-3 py-1.5 text-left backdrop-blur-md shadow-lg"
        aria-expanded={isOpen}
        aria-controls="narrative-angle-options"
      >
        <Filter className="size-3.5 text-app-accent" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-text">
          <span className="md:hidden">{activeLabel}</span>
          <span className="hidden md:inline">Agrupar evidencia UGC</span>
        </span>
        <ChevronDown className={`ml-auto size-3.5 text-app-muted transition-transform md:hidden ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <div id="narrative-angle-options" className={`${isOpen ? 'flex' : 'hidden'} flex-col gap-1 border border-app-border bg-app-surface/95 p-1.5 backdrop-blur-md shadow-2xl md:flex`}>
        {NARRATIVE_ANGLES.map((angle) => {
          const Icon = angle.icon;
          const isSelected = activeAngle === angle.id;
          const displayCount = nodeCounts?.[angle.id] ?? 0;

          return (
            <button
              key={angle.id}
              onClick={() => onChangeAngle(angle.id)}
              disabled={angle.id !== 'all' && displayCount === 0}
              className={`flex items-center justify-between gap-3 px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider transition-all ${
                isSelected
                  ? 'bg-app-accent text-slate-950 font-bold shadow-md'
                  : displayCount === 0
                    ? 'cursor-not-allowed text-app-muted/35'
                    : 'text-app-muted hover:bg-app-subtle hover:text-app-text'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Icon className={`size-3.5 shrink-0 ${isSelected ? 'text-slate-950' : 'text-app-accent'}`} />
                <span className="truncate">{angle.label}</span>
              </div>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                  isSelected ? 'bg-slate-950 text-app-accent' : 'bg-app-border/80 text-app-muted'
                }`}
              >
                {displayCount}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
