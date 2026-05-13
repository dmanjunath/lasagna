// Layer Home Screen — Phase 1: The Guidance Engine
//
// Barrel export for all layer-home components.
//

export { LayerHomeScreen } from './LayerHomeScreen';
export { DebtCascade } from './DebtCascade';
export {
  DEEP_DEBT_PERSONA,
  BUILDING_WEALTH_PERSONA,
  MIXED_PERSONA,
  ALL_PERSONAS,
  getMockPersona,
  getDefaultMockPersona,
  getPrimaryLayer,
  getSecondaryLayers,
  getNextLayer,
  isDebtUser,
  isFireUser,
  calculateCascade,
  formatDateShort,
} from './layer-mocks';
export type { MockPersona, MockDebt, MockInsight, PriorityStep, PrioritySummary } from './types';
