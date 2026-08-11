import { ArrowRight, Database, Sparkles } from 'lucide-react';
import { CONTENT_NODES, PRODUCT } from '../productData';

interface IntroScreenProps {
  onStart: () => void;
}

export default function IntroScreen({ onStart }: IntroScreenProps) {
  return (
    <main className="product-grid h-full w-full overflow-y-auto px-5 py-6 md:px-10 md:py-8 lg:px-16">
      <div className="mx-auto flex min-h-full max-w-[1500px] flex-col">
        <header className="flex items-center justify-between border-b border-app-border/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center border border-app-border text-2xl text-app-muted">◎</div>
            <div>
              <p className="font-display text-2xl font-bold uppercase leading-none tracking-[0.04em]">Product World</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-app-muted">UGC research system</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-accent sm:flex">
            <span className="size-1.5 bg-app-accent" />
            Extracción lista
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-12">
          <div className="max-w-3xl">
            <div className="mb-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-product-accent">
              <Sparkles className="size-4" />
              Un producto · múltiples historias
            </div>
            <h1 className="max-w-3xl font-display text-[clamp(3.6rem,7.4vw,8.5rem)] font-bold uppercase leading-[0.82] tracking-[-0.035em] text-app-text">
              Un mundo de contenido.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-relaxed text-app-muted md:text-lg">
              La investigación de una sola chaqueta convertida en un mapa navegable de datos, detalles y ángulos UGC listos para desarrollar.
            </p>

            <div className="mt-8 grid max-w-2xl grid-cols-3 border-y border-app-border/80 py-5">
              <IntroMetric value={String(CONTENT_NODES.length)} label="Nodos UGC" />
              <IntroMetric value={PRODUCT.rating} label="Calificación" />
              <IntroMetric value={PRODUCT.sold} label="Vendidos" />
            </div>

            <button
              onClick={onStart}
              className="group mt-8 flex w-full max-w-md items-center justify-between border border-product-accent bg-product-accent px-6 py-4 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#090b0e] transition-colors hover:border-app-text hover:bg-app-text"
            >
              Explorar mundo UGC
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </button>

            <p className="mt-5 flex max-w-xl items-start gap-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-app-muted">
              <Database className="mt-0.5 size-3.5 shrink-0 text-app-accent" />
              Datos extraídos estáticamente. Los hooks, formatos y shot lists están marcados como propuestas creativas.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[560px] lg:mr-0">
            <div className="absolute -left-5 top-8 hidden h-[82%] w-full border border-app-border/60 md:block" />
            <div className="relative border border-app-border bg-app-surface p-3 shadow-[0_32px_90px_rgba(0,0,0,0.42)]">
              <div className="relative aspect-[4/5] overflow-hidden bg-app-subtle">
                <img src="/product/01_gallery.jpg" alt="Chaqueta de ante sintético color caramelo" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-[#07090d]/88 p-5 backdrop-blur-sm">
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-product-accent">Producto investigado</p>
                  <p className="mt-2 max-w-md text-lg font-semibold leading-tight text-app-text md:text-xl">{PRODUCT.shortName}</p>
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <p className="font-mono text-xl text-product-accent">{PRODUCT.price}</p>
                      <p className="font-mono text-[10px] text-app-muted line-through">{PRODUCT.originalPrice}</p>
                    </div>
                    <div className="border border-product-accent px-3 py-2 font-mono text-xs text-product-accent">−{PRODUCT.discount}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function IntroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-l border-app-border/70 px-3 first:border-l-0 first:pl-0 md:px-6">
      <p className="font-mono text-xl text-app-text md:text-2xl">{value}</p>
      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em] text-app-muted md:text-[9px]">{label}</p>
    </div>
  );
}
