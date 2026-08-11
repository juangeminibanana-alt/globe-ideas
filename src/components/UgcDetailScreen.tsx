import { Clapperboard, Database, Lightbulb, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { UgcNode } from '../productData';

interface UgcDetailProps {
  data: UgcNode;
  onClose: () => void;
}

export default function UgcDetailScreen({ data, onClose }: UgcDetailProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-50 flex items-center justify-center p-3 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ugc-angle-title"
    >
      <div className="absolute inset-0 bg-[#020305]/90 backdrop-blur-md" onClick={onClose} />

      <motion.article
        initial={{ scale: 0.94, opacity: 0, y: 18 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 18 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex h-full max-h-[860px] w-full max-w-7xl flex-col overflow-hidden border border-app-border bg-app-surface shadow-[0_30px_120px_rgba(0,0,0,0.7)] md:flex-row"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-20 grid size-11 place-items-center rounded-full border border-app-border bg-app-bg/90 text-app-text transition-colors hover:border-product-accent hover:text-product-accent md:right-6 md:top-6"
          aria-label="Cerrar ficha UGC"
        >
          <X className="size-5" />
        </button>

        <div className="relative h-[34vh] min-h-[240px] w-full shrink-0 overflow-hidden bg-app-subtle md:h-full md:w-[48%]">
          {data.video ? (
            <video src={data.video} autoPlay loop muted playsInline poster={data.image} className="h-full w-full object-cover" />
          ) : (
            <img src={data.image} alt={data.imageAlt} className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-[#05070a]/84 p-4 backdrop-blur-sm md:p-6">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-product-accent">{data.category}</p>
              <p className="mt-1 font-display text-2xl font-semibold uppercase tracking-wide text-app-text">{data.label}</p>
            </div>
            {data.video && <span className="border border-app-accent/60 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-app-accent">Video extraído</span>}
          </div>
        </div>

        <div className="w-full overflow-y-auto p-5 sm:p-8 md:w-[52%] md:p-10 lg:p-12">
          <SectionLabel icon={<Database className="size-3.5" />} label="Dato extraído" />
          <p className="mt-3 text-base leading-relaxed text-app-text">{data.extractedFact}</p>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-app-muted">Fuente · {data.evidence}</p>

          <div className="my-7 border-t border-app-border" />

          <SectionLabel icon={<Lightbulb className="size-3.5" />} label="Ángulo UGC propuesto" tone="warm" />
          <h2 id="ugc-angle-title" className="mt-3 text-2xl font-semibold leading-tight text-app-text md:text-3xl">{data.angle}</h2>

          <div className="mt-7 grid gap-7 lg:grid-cols-2">
            <ContentBlock label="Hook">
              <p>“{data.hook}”</p>
            </ContentBlock>
            <ContentBlock label="Formato">
              <p className="flex items-start gap-2"><Clapperboard className="mt-0.5 size-4 shrink-0 text-app-accent" />{data.format}</p>
            </ContentBlock>
          </div>

          <div className="mt-7">
            <ContentBlock label="Shot list">
              <ol className="mt-3 space-y-2">
                {data.shots.map((shot, index) => (
                  <li key={shot} className="flex gap-3">
                    <span className="font-mono text-[10px] text-product-accent">{String(index + 1).padStart(2, '0')}</span>
                    <span>{shot}</span>
                  </li>
                ))}
              </ol>
            </ContentBlock>
          </div>

          <div className="mt-7 border-l-2 border-product-accent bg-product-accent/5 px-4 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-product-accent">CTA</p>
            <p className="mt-2 text-sm leading-relaxed text-app-text">{data.cta}</p>
          </div>
        </div>
      </motion.article>
    </motion.div>
  );
}

function SectionLabel({ icon, label, tone = 'cool' }: { icon: React.ReactNode; label: string; tone?: 'cool' | 'warm' }) {
  return (
    <div className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] ${tone === 'warm' ? 'text-product-accent' : 'text-app-accent'}`}>
      {icon}
      {label}
    </div>
  );
}

function ContentBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm leading-relaxed text-app-muted">
      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-product-accent">{label}</p>
      {children}
    </div>
  );
}
