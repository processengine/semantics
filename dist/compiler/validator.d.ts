import type { PrepareFlowOptions, ValidateFlowOptions } from './contracts.js';
import type { ValidationResult } from '../errors/types.js';
export type { ValidationIssue, ValidationResult } from '../errors/types.js';
export declare function validateFlow(flow: unknown, _options?: ValidateFlowOptions): ValidationResult;
export declare function prepareFlow(flow: unknown, options?: PrepareFlowOptions): import("./compiled.js").PreparedFlow;
