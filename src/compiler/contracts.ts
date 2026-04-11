export interface DecisionSetContract {
  outcomes?: string[];
}

export interface FlowRegistry {
  hasArtefact?(artefactId: string): boolean;
  hasDecisionSet?(decisionSetId: string): boolean;
  getDecisionSetContract?(decisionSetId: string): DecisionSetContract | undefined;
}

export interface ValidateFlowOptions {
  registry?: FlowRegistry;
  strict?: boolean;
}

export interface PrepareFlowOptions extends ValidateFlowOptions {}
