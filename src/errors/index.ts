import type { FlowCompileCode, FlowRuntimeCode, ValidationIssue } from './types.js';

export type {
  FlowCompileCode,
  FlowErrorCode,
  FlowRuntimeCode,
  FlowValidationCode,
  ValidationIssue,
  ValidationResult,
} from './types.js';

abstract class XBaseError extends Error {
  abstract readonly phase: 'prepare' | 'runtime';
  readonly library = 'flows';
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(name: 'XCompileError' | 'XRuntimeError', code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = name;
    this.code = code;
    this.details = details ? structuredClone(details) : {};
  }
}

export class XCompileError extends XBaseError {
  readonly phase = 'prepare' as const;
  readonly diagnostics: ValidationIssue[];

  constructor(message: string, diagnostics: ValidationIssue[]) {
    super('XCompileError', 'FLOW_PREPARE_INVALID', message, { diagnostics });
    this.diagnostics = structuredClone(diagnostics);
  }
}

export class XRuntimeError extends XBaseError {
  readonly phase = 'runtime' as const;

  constructor(code: FlowRuntimeCode, message: string, details?: Record<string, unknown>) {
    super('XRuntimeError', code, message, details);
  }
}
