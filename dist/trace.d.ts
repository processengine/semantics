import type { FlowTraceMode, ProcessState, StepRuntimeState, TimelineEntry } from './runtime/types.js';
interface FlowTraceEntryBase {
    stepId: string;
    kind: TimelineEntry['kind'];
    at: string;
    status: TimelineEntry['status'];
}
export interface BasicFlowTraceEntry extends FlowTraceEntryBase {
    mode: 'basic';
}
export interface VerboseFlowTraceEntry extends FlowTraceEntryBase {
    mode: 'verbose';
    executionId: string;
    details: Record<string, unknown> | undefined;
    runtime: StepRuntimeState | null;
}
export type FlowTraceEntry = BasicFlowTraceEntry | VerboseFlowTraceEntry;
export declare function createFlowTrace(state: ProcessState, mode?: FlowTraceMode): FlowTraceEntry[];
export declare function formatFlowTrace(trace: FlowTraceEntry[] | null): string;
export {};
