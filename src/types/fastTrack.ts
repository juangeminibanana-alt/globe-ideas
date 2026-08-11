export type FastTrackStatus =
  | 'extracting'
  | 'failed'
  | 'needs-background'
  | 'blocked-watermark'
  | 'research-ready'
  | 'building-bible'
  | 'generating-video'
  | 'complete'
  | string;

export type WorldCategory = 'research' | 'images' | 'bible' | 'video' | 'data';

export type ArtifactKind = 'image' | 'video' | 'json' | 'csv' | 'text' | 'html' | 'other';

export interface RunMetrics {
  rating?: string | number;
  sold?: string | number;
  reviews?: string | number;
  images?: number;
  artifacts?: number;
  stock?: string | number;
  imageCount?: number;
  galleryCount?: number;
  videoCount?: number;
  finalVideoCount?: number;
  reviewCount?: number;
  soldCount?: number;
}

export interface FastTrackRunSummary {
  id: string;
  productId: string;
  title: string;
  status: FastTrackStatus;
  updatedAt: string;
  completedAt?: string;
  durationSeconds?: number;
  metrics?: RunMetrics;
  thumbnailArtifactId?: string;
  thumbnailUrl?: string;
  thumbnailOriginalUrl?: string;
  finalVideoArtifactId?: string;
  finalVideoUrl?: string;
  manifestUrl?: string;
}

export interface FastTrackRunsResponse {
  rootAvailable: boolean;
  runs: FastTrackRunSummary[];
}

export interface ProductWorldCatalogItem {
  id: string;
  productId: string;
  name: string;
  title: string;
  heroUrl: string;
  heroHasAlpha: boolean;
  sourceCount: number;
  updatedAt: string;
  manifestUrl: string;
}

export interface ProductWorldCatalogResponse {
  schemaVersion: string;
  generatedAt: string;
  worlds: ProductWorldCatalogItem[];
}

export interface ProductSummary {
  id: string;
  title: string;
  shortName?: string;
  price?: string;
  originalPrice?: string;
  discount?: string;
  saving?: string;
  rating?: string | number;
  sold?: string | number;
  shipping?: string;
  seller?: string;
  stock?: string | number;
  category?: string;
  heroImageUrl?: string;
  heroDisplayUrl?: string;
  heroTransparentUrl?: string;
  description?: string[];
}

export interface ReviewSample {
  id?: string;
  author?: string;
  rating?: number;
  text: string;
  verified?: boolean;
  incentivized?: boolean;
  imageCount?: number;
}

export interface ReviewSummary {
  total: number;
  capturedCount: number;
  hasMore: boolean;
  sample: ReviewSample[];
}

export interface FastTrackArtifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  filename?: string;
  mimeType: string;
  size: number;
  url: string;
  displayUrl?: string;
  transparentUrl?: string;
  backgroundMode?: 'transparent' | 'preserved';
  role?: string;
  stage?: WorldCategory;
  modifiedAt?: string;
  durationSeconds?: number;
}

export interface WorldNode {
  id: string;
  label: string;
  category: WorldCategory;
  kind?: ArtifactKind | 'fact' | 'review' | 'stage';
  summary: string;
  evidence?: string;
  state?: 'ready' | 'active' | 'pending' | 'blocked' | 'failed';
  artifactId?: string;
  thumbnailUrl?: string;
  transparentUrl?: string;
  imageFit?: 'cover' | 'contain';
  imageAlt?: string;
  badge?: string;
  plainText?: string;
  code?: unknown;
  metadata?: Record<string, unknown>;
}

export interface FastTrackManifest {
  schemaVersion: string;
  run: FastTrackRunSummary & {
    stage?: string;
    sourceUrl?: string;
    vibe?: string;
  };
  product: ProductSummary;
  metrics: RunMetrics;
  reviews: ReviewSummary;
  artifacts: FastTrackArtifact[];
  nodes: WorldNode[];
}

export type WorldFilter = 'all' | WorldCategory;
