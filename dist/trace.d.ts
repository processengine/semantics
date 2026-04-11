import type { FlowTraceMode, ProcessHistoryEntry, ProcessState, StepRuntimeState } from './runtime/types.js';
interface FlowTraceEntryBase {
    stepId: string;
    kind: ProcessHistoryEntry['kind'];
    at: string;
}
export interface BasicFlowTraceEntry extends FlowTraceEntryBase {
    mode: 'basic';
}
export interface VerboseFlowTraceEntry extends FlowTraceEntryBase {
    mode: 'verbose';
    details: Record<string, unknown> | undefined;
    runtime: StepRuntimeState | null;
}
export type FlowTraceEntry = BasicFlowTraceEntry | VerboseFlowTraceEntry;
export declare function createFlowTrace(state: ProcessState, mode?: FlowTraceMode): FlowTraceEntry[] | null;
export declare function formatFlowTrace(trace: FlowTraceEntry[] | null): string;
export {};
