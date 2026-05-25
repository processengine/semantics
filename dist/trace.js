export function createFlowTrace(state, mode = state.traceMode) {
    if (mode !== 'verbose') {
        return state.timeline.map((entry) => ({
            mode: 'basic',
            stepId: entry.stepId,
            kind: entry.kind,
            status: entry.status,
            at: entry.at,
        }));
    }
    return state.timeline.map((entry) => {
        const runtime = state.steps[entry.stepId] ?? null;
        const execution = runtime?.executions.find((candidate) => candidate.executionId === entry.executionId) ?? null;
        return {
            mode: 'verbose',
            executionId: entry.executionId,
            stepId: entry.stepId,
            kind: entry.kind,
            status: entry.status,
            at: entry.at,
            details: execution ? buildExecutionDetails(execution) : undefined,
            runtime,
        };
    });
}
export function formatFlowTrace(trace) {
    if (trace === null)
        return 'trace empty';
    if (trace.length === 0)
        return 'trace empty';
    return trace
        .map((entry) => {
        const base = `[${entry.mode}] ${entry.at} ${entry.stepId} ${entry.kind} ${entry.status}`;
        if (entry.mode === 'basic')
            return base;
        const segments = [`executionId=${entry.executionId}`];
        const latestExecutionId = entry.runtime?.latestExecutionId;
        if (latestExecutionId)
            segments.push(`latestExecutionId=${latestExecutionId}`);
        if (entry.details)
            segments.push(`details=${JSON.stringify(entry.details)}`);
        return `${base} ${segments.join(' ')}`;
    })
        .join('\n');
}
function buildExecutionDetails(execution) {
    const details = {};
    if (execution.nextStepId)
        details['nextStepId'] = execution.nextStepId;
    if (execution.failureCode)
        details['failureCode'] = execution.failureCode;
    if (execution.reason)
        details['reason'] = execution.reason;
    if (execution.dataflow)
        details['dataflow'] = execution.dataflow;
    if (execution.route)
        details['route'] = execution.route;
    if (execution.command)
        details['command'] = execution.command;
    if (execution.subflow)
        details['subflow'] = execution.subflow;
    if (execution.wait)
        details['wait'] = execution.wait;
    if (execution.terminal)
        details['terminal'] = execution.terminal;
    return Object.keys(details).length > 0 ? details : undefined;
}
