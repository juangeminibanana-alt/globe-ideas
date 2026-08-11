import { useMemo } from 'react';
import { useProductWorldCatalog } from '../hooks/useProductWorldCatalog';
import LoadingOverlay from './LoadingOverlay';
import ProductWorldCanvas, { type ProductWorldCanvasItem } from './ProductWorldCanvas';

interface WorldsHomeProps {
  onOpenWorld: (productId: string) => void;
}

export default function WorldsHome({ onOpenWorld }: WorldsHomeProps) {
  const { worlds, isLoading, error } = useProductWorldCatalog();
  const canvasWorlds = useMemo<ProductWorldCanvasItem[]>(() => worlds.map((world) => ({
    id: world.id,
    productId: world.productId,
    name: world.name || world.title,
    imageUrl: world.heroUrl,
    imageHasAlpha: world.heroHasAlpha,
  })), [worlds]);

  if (isLoading && !canvasWorlds.length) {
    return <LoadingOverlay label="Localizando mundos de producto" />;
  }

  return (
    <main className="relative h-full min-h-[100dvh] overflow-hidden bg-app-bg text-app-text">
      {canvasWorlds.length ? (
        <ProductWorldCanvas worlds={canvasWorlds} onOpenWorld={onOpenWorld} />
      ) : (
        <div className="grid h-full min-h-[100dvh] place-items-center px-6 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-app-muted">
          {error ?? 'No hay mundos de producto disponibles'}
        </div>
      )}

      {error && canvasWorlds.length ? (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-4 bottom-4 mx-auto w-fit max-w-[min(32rem,calc(100%-2rem))] bg-app-bg/90 px-4 py-2 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-product-accent backdrop-blur-sm"
        >
          {error}
        </div>
      ) : null}
    </main>
  );
}
