import { XRuntimeError } from './errors/index.js';
import type { ValidationIssue } from './errors/types.js';
export declare function formatValidationIssues(issues: ValidationIssue[]): string;
export declare function formatRuntimeError(error: XRuntimeError): string;
