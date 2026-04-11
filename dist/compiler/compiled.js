export function normalizeSteps(steps) {
    const normalized = {};
    for (const [stepId, step] of Object.entries(steps)) {
        normalized[stepId] = structuredClone(step);
    }
    return normalized;
}
export function createPreparedFlow(flow) {
    const prepared = {
        id: flow.id,
        version: flow.version,
        entryStepId: flow.entryStepId,
        orderedStepIds: Object.keys(flow.steps),
        stepsById: normalizeSteps(flow.steps),
        ...(flow.metadata !== undefined ? { metadata: structuredClone(flow.metadata) } : {}),
        ...(flow.title !== undefined ? { title: flow.title } : {}),
        ...(flow.description !== undefined ? { description: flow.description } : {}),
    };
    return deepFreeze(prepared);
}
export function asPreparedFlowInternal(flow) {
    return flow;
}
export function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const nested of Object.values(value)) {
        if (nested !== null && typeof nested === 'object')
            deepFreeze(nested);
    }
    return value;
}
