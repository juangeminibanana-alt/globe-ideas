import { ArrowLeft, ArrowRight, BookOpenCheck, Database, FileSearch, Image, Search, Video, X, Info } from 'lucide-react';
import type { ProductHotspot } from '../data/hotspots';

interface HotspotNoteCardProps {
  hotspot: ProductHotspot;
  currentIndex: number;
  totalHotspots: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSelectRelatedCategory?: (category: string) => void;
}
const CATEGORY_ICONS = {
  research: Search,
  images: Image,
  bible: BookOpenCheck,
  video: Video,
  data: Database,
};

export default function HotspotNoteCard({
  hotspot,
  currentIndex,
  totalHotspots,
  onClose,
  onNext,
  onPrev,
  onSelectRelatedCategory,
}: HotspotNoteCardProps) {
  const IconComponent = CATEGORY_ICONS[hotspot.category] || Info;

  return (
    <div className="absolute top-6 left-1/2 z-40 w-[92%] max-w-md -translate-x-1/2 animate-fadeIn sm:left-auto sm:right-6 sm:translate-x-0">
      <div
        className="relative overflow-hidden border bg-slate-950/95 p-5 text-slate-100 backdrop-blur-xl shadow-2xl transition-all"
        style={{
          borderColor: hotspot.highlightColor,
          boxShadow: `0 10px 30px -10px ${hotspot.highlightColor}33`,
        }}
      >
        {/* Glowing Top Accent Line */}
        <div
          className="absolute top-0 left-0 h-1 w-full"
          style={{ backgroundColor: hotspot.highlightColor }}
        />

        {/* Card Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <div
              className="flex size-7 items-center justify-center rounded-full font-mono text-xs font-black shadow-inner"
              style={{
                backgroundColor: hotspot.highlightColor,
                color: '#03070b',
              }}
            >
              {hotspot.number}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <IconComponent className="size-3.5" style={{ color: hotspot.highlightColor }} />
                <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400">
                  EVIDENCIA {currentIndex + 1} DE {totalHotspots}
                </span>
              </div>
              <span
                className="font-mono text-[10px] font-extrabold uppercase tracking-wider"
                style={{ color: hotspot.highlightColor }}
              >
                {hotspot.tag}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded border border-slate-800 text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
            title="Cerrar nota informativa"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Card Body & Note Content */}
        <div className="mt-4 space-y-3">
          <h3 className="font-display text-base font-bold uppercase tracking-wide text-white">
            {hotspot.title}
          </h3>

          {/* Technical Spec Banner */}
          <div className="border-l-2 bg-slate-900/80 p-2.5 font-mono text-[11px] font-semibold text-slate-200" style={{ borderColor: hotspot.highlightColor }}>
            <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-normal mb-0.5">
              Evidencia del manifiesto
            </span>
            {hotspot.spec}
          </div>

          {/* Explanatory Note */}
          <p className="font-mono text-xs leading-relaxed text-slate-300">
            {hotspot.note}
          </p>

          {/* Related Category Action Link */}
          {hotspot.relatedCategory && onSelectRelatedCategory && (
            <button
              onClick={() => onSelectRelatedCategory(hotspot.relatedCategory!)}
              className="mt-1 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-app-accent hover:underline"
            >
              <FileSearch className="size-3" />
              <span>Abrir este nodo en el inspector →</span>
            </button>
          )}
        </div>

        {/* Footer Navigation Bar */}
        <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-3 font-mono text-[10px]">
          <div className="flex items-center gap-1">
            <button
              onClick={onPrev}
              className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-bold uppercase text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              <ArrowLeft className="size-3" />
              <span>Ant</span>
            </button>
            <button
              onClick={onNext}
              className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-bold uppercase text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              <span>Sig</span>
              <ArrowRight className="size-3" />
            </button>
          </div>

          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            Usar flechas para explorar
          </span>
        </div>
      </div>
    </div>
  );
}
