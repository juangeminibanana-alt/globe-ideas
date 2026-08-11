import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProductWorldCatalogItem,
  ProductWorldCatalogResponse,
} from '../types/fastTrack';

const CATALOG_POLL_INTERVAL_MS = 60_000;
let catalogCache: ProductWorldCatalogItem[] = [];

export function useProductWorldCatalog() {
  const [worlds, setWorlds] = useState<ProductWorldCatalogItem[]>(catalogCache);
  const [isLoading, setIsLoading] = useState(catalogCache.length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false, force = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (background) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const response = await fetch(`/api/product-worlds/catalog${force ? '?refresh=1' : ''}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`No se pudo cargar el cat\u00e1logo (${response.status})`);
      const payload = await response.json() as ProductWorldCatalogResponse;
      if (!Array.isArray(payload.worlds)) throw new Error('El cat\u00e1logo no contiene mundos v\u00e1lidos.');

      catalogCache = payload.worlds;
      setWorlds(payload.worlds);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Error desconocido al cargar el cat\u00e1logo.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(catalogCache.length > 0);
    const timer = window.setInterval(() => void load(true), CATALOG_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, [load]);

  return {
    worlds,
    isLoading,
    isRefreshing,
    error,
    refresh: () => load(Boolean(worlds.length), true),
  };
}
