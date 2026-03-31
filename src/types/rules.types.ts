import type { Platform } from './sync.types';

export interface ConcatenateExpression {
  parts: Array<
    | { type: 'field'; value: string }
    | { type: 'literal'; value: string }
  >;
}

export interface StaticExpression {
  value: string;
}

export interface CalculatorExpression {
  field: string;
  operator: '+' | '-' | '*' | '/';
  operand: number;
}

export type RuleExpression =
  | ConcatenateExpression
  | StaticExpression
  | CalculatorExpression;

export interface SyncRule {
  id: string;
  instanceId: string;
  name: string;
  platform: Platform | 'both';
  field: string;
  type: 'concatenate' | 'static' | 'calculator';
  expression: RuleExpression;
  order: number;
  enabled: boolean;
}

export interface SyncFilter {
  id: string;
  instanceId: string;
  name: string;
  platform: Platform | 'both';
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  value: string;
  conditionGroup: 'AND' | 'OR';
  order: number;
  enabled: boolean;
}

export interface EnhancedContent {
  id: string;
  instanceId: string;
  productId: string;
  platform: Platform | 'both';
  enhancedTitle?: string;
  enhancedDescription: string;
  sourceHash: string;
  generatedAt: string;
}
