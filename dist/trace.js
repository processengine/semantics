export function createFlowTrace(state, mode = state.traceMode) {
    if (mode === 'off')
        return null;
    if (mode === 'basic') {
        return state.history.map((entry) => ({
            mode: 'basic',
            stepId: entry.stepId,
            kind: entry.kind,
            at: entry.at,
        }));
    }
    return state.history.map((entry) => ({
        mode: 'verbose',
        stepId: entry.stepId,
        kind: entry.kind,
        at: entry.at,
        details: entry.details,
        runtime: state.context.steps[entry.stepId] ?? null,
    }));
}
export function formatFlowTrace(trace) {
    if (trace === null)
        return 'trace disabled';
    if (trace.length === 0)
        return 'trace empty';
    return trace
        .map((entry) => {
        const base = `[${entry.mode}] ${entry.at} ${entry.stepId} ${entry.kind}`;
        if (entry.mode === 'basic')
            return base;
        const segments = [];
        if (entry.runtime?.requestId)
            segments.push(`requestId=${entry.runtime.requestId}`);
        if (entry.runtime?.selectedNextStepId)
            segments.push(`next=${entry.runtime.selectedNextStepId}`);
        if (entry.runtime?.failureCode)
            segments.push(`failureCode=${entry.runtime.failureCode}`);
        if (entry.details)
            segments.push(`details=${JSON.stringify(entry.details)}`);
        return segments.length > 0 ? `${base} ${segments.join(' ')}` : base;
    })
        .join('\n');
}
