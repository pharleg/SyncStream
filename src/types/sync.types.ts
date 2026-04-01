import type { ValidationError } from './wix.types';

export type Platform = 'gmc' | 'meta';

export interface SyncResult {
  productId: string;
  platform: Platform;
  success: boolean;
  externalId?: string;
  errors?: ValidationError[];
}

export interface BatchSyncResult {
  total: number;
  synced: number;
  failed: number;
  results: SyncResult[];
}

export interface SyncOptions {
  platforms: Platform[];
  productIds?: string[];
  fullSync?: boolean;
  offset?: number;
}

export interface SyncProgress {
  instanceId: string;
  totalProducts: number;
  processed: number;
  currentStatus: 'running' | 'completed' | 'error';
  syncedCount: number;
  failedCount: number;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

export interface PaginatedSyncResult extends BatchSyncResult {
  progress: SyncProgress;
}
