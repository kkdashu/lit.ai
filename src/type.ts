
export interface SubGoal {
  index: number;
  description: string;
  status: 'pending' | 'running' | 'finished';
}

export interface AIAction {
  type: string;
  param?: any;
  thought?: string;
  log?: string;
  error?: string;
  finalizeMessage?: string;
  finalizeSuccess?: boolean;

  // DeepThink / SubGoal related
  updateSubGoals?: SubGoal[];
  markFinishedIndexes?: number[];
  memory?: string;
}
