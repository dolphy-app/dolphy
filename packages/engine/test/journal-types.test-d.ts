import type { LogEntryDto } from '@spirula/engine-contract';
import { expectTypeOf, test } from 'vitest';
import type { LogEntry } from '../src/index.ts';

test('LogEntry совпадает с LogEntryDto контракта', () => {
  expectTypeOf<LogEntry>().toEqualTypeOf<LogEntryDto>();
});
