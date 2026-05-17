import type { PrepareFlowOptions, ValidateFlowOptions } from './contracts.js';
import type { ValidationResult } from '../errors/types.js';
export type { ValidationIssue, ValidationResult } from '../errors/types.js';
export declare function validateFlow(source: unknown, options?: ValidateFlowOptions): ValidationResult;
export declare function prepareFlow(source: unknown, options?: PrepareFlowOptions): import('./compiled.js').PreparedFlow;
