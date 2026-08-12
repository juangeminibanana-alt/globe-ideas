import type { WorldCategory, WorldNode } from '../types/fastTrack';

export interface ProductHotspot {
  id: string;
  nodeId: string;
  number: number;
  title: string;
  category: WorldCategory;
  tag: string;
  position: [number, number, number];
  highlightColor: string;
  note: string;
  spec: string;
  relatedCategory: WorldCategory;
}

const POSITIONS: Array<[number, number, number]> = [
  [0, 4.2, 4.4],
  [4.2, 2.1, 3.8],
  [-4.5, 1.8, 3.8],
  [2.5, -4.2, 3.5],
  [-3.8, -3.2, 3.8],
];

const CATEGORY_META: Record<WorldCategory, { label: string; color: string }> = {
  research: { label: 'Investigación', color: '#80e6b0' },
  images: { label: 'Imagen', color: '#68e7ff' },
  bible: { label: 'Product Bible', color: '#ff7da9' },
  video: { label: 'Video', color: '#ffd166' },
  data: { label: 'Datos', color: '#a78bfa' },
};

function nodeScore(node: WorldNode) {
  let score = 0;
  if (node.state === 'ready') score += 4;
  if (node.artifactId) score += 3;
  if (node.thumbnailUrl) score += 2;
  if (node.evidence) score += 1;
  return score;
}

export function getNodeHotspots(nodes: WorldNode[], maximum = 5): ProductHotspot[] {
  const categoryOrder: WorldCategory[] = ['images', 'research', 'bible', 'video', 'data'];
  const selected: WorldNode[] = [];
  const seen = new Set<string>();

  for (const category of categoryOrder) {
    const representative = nodes
      .filter((node) => node.category === category)
      .sort((left, right) => nodeScore(right) - nodeScore(left))[0];
    if (representative && !seen.has(representative.id)) {
      selected.push(representative);
      seen.add(representative.id);
    }
  }

  for (const node of [...nodes].sort((left, right) => nodeScore(right) - nodeScore(left))) {
    if (selected.length >= maximum) break;
    if (seen.has(node.id)) continue;
    selected.push(node);
    seen.add(node.id);
  }

  return selected.slice(0, maximum).map((node, index) => {
    const meta = CATEGORY_META[node.category];
    const state = node.state === 'active' ? 'En proceso' : node.state === 'pending' ? 'Pendiente' : 'Listo';
    return {
      id: `hotspot-${node.id}`,
      nodeId: node.id,
      number: index + 1,
      title: node.label,
      category: node.category,
      tag: meta.label,
      position: POSITIONS[index],
      highlightColor: meta.color,
      note: node.summary,
      spec: node.evidence || `${node.kind ?? 'evidencia'} · ${state}`,
      relatedCategory: node.category,
    };
  });
}
