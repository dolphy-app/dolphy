import { expectTypeOf, test } from 'vitest';
import type { EngineEvent, LogEntryDto } from '../src/index.ts';

/** Каждое значение `type` учтено, а `default` сводится к `never`. */
const describeEvent = (event: EngineEvent): string => {
  switch (event.type) {
    case 'progress':
      expectTypeOf(event).toEqualTypeOf<{
        type: 'progress';
        unitIds: string[];
        at: number;
      }>();
      return `progress ${event.unitIds.length}`;
    case 'library-reloaded':
      return `reloaded ${event.revision} ${event.errors} ${event.warnings}`;
    case 'library-compiled':
      return `compiled ${event.artifactWritten}`;
    case 'state-rebuilt':
      return `rebuilt ${event.entries} ${event.ms}`;
    case 'sync-conflict':
      return `conflict ${event.conflictIds.length} ${event.unresolved}`;
    case 'remediation-triggered':
      return `remediation ${event.exerciseId} ${event.steps}`;
    case 'settings-changed':
      return event.scope;
    case 'repository-progress':
      return `repository ${event.id} ${event.phase}`;
    case 'extensions-changed':
    case 'extension-health-changed':
      return event.type;
    case 'contributions-changed':
      expectTypeOf(event.generation).toEqualTypeOf<number>();
      return `contributions ${event.generation}`;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
};

/** То же для записей журнала: по `kind` сужается до своих полей. */
const describeEntry = (entry: LogEntryDto): string => {
  switch (entry.kind) {
    case 'attempt':
      expectTypeOf(entry.grade).toEqualTypeOf<1 | 2 | 3 | 4 | 5>();
      return `${entry.exerciseId} ${entry.grade} ${entry.source}`;
    case 'unit_flag':
      expectTypeOf(entry.flag).toEqualTypeOf<'blacklist' | 'review'>();
      return `${entry.unitId} ${entry.flag} ${entry.op}`;
    case 'progress_reset':
      expectTypeOf(entry.libraryRevision).toEqualTypeOf<string | undefined>();
      return entry.unitId;
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
};

test('T-20 EngineEvent: набор типов события зафиксирован, обработка исчерпывающая', () => {
  expectTypeOf<EngineEvent['type']>().toEqualTypeOf<
    | 'progress'
    | 'library-reloaded'
    | 'library-compiled'
    | 'state-rebuilt'
    | 'sync-conflict'
    | 'remediation-triggered'
    | 'settings-changed'
    | 'repository-progress'
    | 'extensions-changed'
    | 'extension-health-changed'
    | 'contributions-changed'
  >();
  expectTypeOf(describeEvent).returns.toEqualTypeOf<string>();
});

test('T-20 LogEntryDto: набор kind зафиксирован, обработка исчерпывающая', () => {
  expectTypeOf<LogEntryDto['kind']>().toEqualTypeOf<
    'attempt' | 'unit_flag' | 'progress_reset'
  >();
  expectTypeOf(describeEntry).returns.toEqualTypeOf<string>();
});
