class XBaseError extends Error {
    library = 'flows';
    code;
    details;
    constructor(name, code, message, details) {
        super(message);
        this.name = name;
        this.code = code;
        this.details = details ? structuredClone(details) : {};
    }
}
export class XCompileError extends XBaseError {
    phase = 'prepare';
    diagnostics;
    constructor(message, diagnostics) {
        super('XCompileError', 'FLOW_PREPARE_INVALID', message, { diagnostics });
        this.diagnostics = structuredClone(diagnostics);
    }
}
export class XRuntimeError extends XBaseError {
    phase = 'runtime';
    constructor(code, message, details) {
        super('XRuntimeError', code, message, details);
    }
}
