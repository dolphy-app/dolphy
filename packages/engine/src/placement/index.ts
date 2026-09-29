export { buildTopicGraph } from './topic-graph.ts';
export type { TopicGraph } from './topic-graph.ts';
export {
  CLASS_KNOWN,
  CLASS_UNCERTAIN,
  CLASS_UNKNOWN,
  DIAGNOSTIC_DEFAULTS,
  createDiagnosticSession,
  frontierOf,
  runDiagnostic,
  topicClassName,
} from './diagnostic.ts';
export type {
  DiagnosticConfig,
  DiagnosticSession,
  TopicClass,
} from './diagnostic.ts';
export { buildPlacementTopics } from './topics.ts';
export type {
  PlacementLibrary,
  PlacementTopics,
  PlacementTopicsOptions,
} from './topics.ts';
export {
  PLACEMENT_ATTEMPTS_PER_EXERCISE,
  PLACEMENT_GRADE,
  PLACEMENT_SPACING_MS,
  placementAttempts,
} from './attempts.ts';
export type { PlacementAttempt } from './attempts.ts';
