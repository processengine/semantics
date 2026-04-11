import type { FlowRuntimeCode, ValidationIssue } from './types.js';
export type { FlowCompileCode, FlowErrorCode, FlowRuntimeCode, FlowValidationCode, ValidationIssue, ValidationResult, } from './types.js';
declare abstract class XBaseError extends Error {
    abstract readonly phase: 'prepare' | 'runtime';
    readonly library = "flows";
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(name: 'XCompileError' | 'XRuntimeError', code: string, message: string, details?: Record<string, unknown>);
}
export declare class XCompileError extends XBaseError {
    readonly phase: "prepare";
    readonly diagnostics: ValidationIssue[];
    constructor(message: string, diagnostics: ValidationIssue[]);
}
export declare class XRuntimeError extends XBaseError {
    readonly phase: "runtime";
    constructor(code: FlowRuntimeCode, message: string, details?: Record<string, unknown>);
}
