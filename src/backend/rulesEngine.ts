/**
 * rulesEngine.ts
 *
 * Applies transformation rules to mapped product data.
 * Rules execute in order on each product.
 * Operates on GmcProductInput (post-mapping, pre-validation).
 */

import type { GmcProductInput, GmcProductAttributes } from '../types/gmc.types';
import type {
  SyncRule,
  ConcatenateExpression,
  StaticExpression,
  CalculatorExpression,
} from '../types/rules.types';
import type { Platform } from '../types/sync.types';

/** Read a field value from GmcProductAttributes by name. */
function readField(attrs: GmcProductAttributes, field: string): string {
  const value = (attrs as Record<string, unknown>)[field];
  if (value == null) return '';
  if (typeof value === 'object' && 'amountMicros' in (value as Record<string, unknown>)) {
    const micros = Number((value as { amountMicros: string }).amountMicros);
    return String(micros / 1_000_000);
  }
  return String(value);
}

/** Write a field value to GmcProductAttributes by name. */
function writeField(attrs: GmcProductAttributes, field: string, value: string): void {
  if (field === 'price' || field === 'salePrice') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      (attrs as Record<string, unknown>)[field] = {
        amountMicros: String(Math.round(num * 1_000_000)),
        currencyCode: attrs.price.currencyCode,
      };
    }
    return;
  }
  (attrs as Record<string, unknown>)[field] = value;
}

/** Apply a concatenate rule. */
function applyConcatenate(attrs: GmcProductAttributes, field: string, expr: ConcatenateExpression): void {
  const result = expr.parts
    .map((part) => {
      if (part.type === 'field') return readField(attrs, part.value);
      return part.value;
    })
    .join('');
  writeField(attrs, field, result);
}

/** Apply a static rule. */
function applyStatic(attrs: GmcProductAttributes, field: string, expr: StaticExpression): void {
  writeField(attrs, field, expr.value);
}

/** Apply a calculator rule. */
function applyCalculator(attrs: GmcProductAttributes, field: string, expr: CalculatorExpression): void {
  const currentValue = parseFloat(readField(attrs, expr.field));
  if (isNaN(currentValue)) return;

  let result: number;
  switch (expr.operator) {
    case '+': result = currentValue + expr.operand; break;
    case '-': result = currentValue - expr.operand; break;
    case '*': result = currentValue * expr.operand; break;
    case '/': result = expr.operand !== 0 ? currentValue / expr.operand : currentValue; break;
    default: return;
  }

  writeField(attrs, field, String(result));
}

/** Apply a single rule to a product's attributes. */
function applyRule(attrs: GmcProductAttributes, rule: SyncRule): void {
  switch (rule.type) {
    case 'concatenate':
      applyConcatenate(attrs, rule.field, rule.expression as ConcatenateExpression);
      break;
    case 'static':
      applyStatic(attrs, rule.field, rule.expression as StaticExpression);
      break;
    case 'calculator':
      applyCalculator(attrs, rule.field, rule.expression as CalculatorExpression);
      break;
  }
}

/**
 * Apply all matching rules to a list of GMC products.
 * Rules execute in order on each product.
 */
export function applyRules(
  products: GmcProductInput[],
  rules: SyncRule[],
  platform: Platform,
): GmcProductInput[] {
  const applicable = rules.filter(
    (r) => r.enabled && (r.platform === platform || r.platform === 'both'),
  );

  if (applicable.length === 0) return products;

  for (const product of products) {
    for (const rule of applicable) {
      applyRule(product.productAttributes, rule);
    }
  }

  return products;
}
