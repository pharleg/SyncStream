/**
 * filterEngine.ts
 *
 * Evaluates sync filters against Wix products.
 * Filters are destructive and sequential — a product excluded
 * by filter N cannot be re-included by filter N+1.
 */

import type { WixProduct } from '../types/wix.types';
import type { SyncFilter } from '../types/rules.types';
import type { Platform } from '../types/sync.types';

/**
 * Resolve a dot-path field value from a WixProduct.
 * Examples: "name", "inventory.availabilityStatus", "price.price"
 */
function resolveField(product: WixProduct, fieldPath: string): string | number | boolean | undefined {
  const parts = fieldPath.split('.');
  let current: unknown = product;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (current == null) return undefined;
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return current;
  }
  return String(current);
}

/** Check if a single filter condition matches a product. */
function matchesCondition(product: WixProduct, filter: SyncFilter): boolean {
  const fieldValue = resolveField(product, filter.field);
  const filterValue = filter.value;

  if (fieldValue === undefined) return false;

  const fieldStr = String(fieldValue);
  const fieldNum = Number(fieldValue);
  const filterNum = Number(filterValue);

  switch (filter.operator) {
    case 'equals':
      return fieldStr === filterValue;
    case 'not_equals':
      return fieldStr !== filterValue;
    case 'contains':
      return fieldStr.toLowerCase().includes(filterValue.toLowerCase());
    case 'greater_than':
      return !isNaN(fieldNum) && !isNaN(filterNum) && fieldNum > filterNum;
    case 'less_than':
      return !isNaN(fieldNum) && !isNaN(filterNum) && fieldNum < filterNum;
    default:
      return false;
  }
}

/**
 * Apply filters to a list of products.
 * Products matching the filter conditions are EXCLUDED.
 * Filters execute in order. Execution is destructive.
 *
 * AND group: ALL conditions in the group must match to exclude.
 * OR group: ANY condition match excludes.
 */
export function applyFilters(
  products: WixProduct[],
  filters: SyncFilter[],
  platform: Platform,
): WixProduct[] {
  const applicable = filters.filter(
    (f) => f.enabled && (f.platform === platform || f.platform === 'both'),
  );

  if (applicable.length === 0) return products;

  let remaining = [...products];

  let i = 0;
  while (i < applicable.length) {
    const group = applicable[i].conditionGroup;
    const groupFilters: SyncFilter[] = [];

    while (i < applicable.length && applicable[i].conditionGroup === group) {
      groupFilters.push(applicable[i]);
      i++;
    }

    if (group === 'AND') {
      remaining = remaining.filter((product) => {
        const allMatch = groupFilters.every((f) => matchesCondition(product, f));
        return !allMatch;
      });
    } else {
      remaining = remaining.filter((product) => {
        const anyMatch = groupFilters.some((f) => matchesCondition(product, f));
        return !anyMatch;
      });
    }
  }

  return remaining;
}
