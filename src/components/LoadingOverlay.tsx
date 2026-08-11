import { LoaderCircle } from 'lucide-react';

export default function LoadingOverlay({ label = 'Cargando resultados' }: { label?: string }) {
  return (
    <div className="product-grid grid h-full w-full place-items-center bg-app-bg px-4">
      <div className="text-center">
        <LoaderCircle className="mx-auto size-8 animate-spin text-app-accent" />
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-app-muted">{label}</p>
        <div className="mx-auto mt-4 h-px w-32 overflow-hidden bg-app-border">
          <div className="loading-scan h-full w-1/2 bg-product-accent" />
        </div>
      </div>
    </div>
  );
}
