import { layoutCourses } from './layout.ts';
import type { CoursesLayout, LayoutInput } from './layout.ts';

export interface LayoutRequest extends LayoutInput {
  id: number;
}

export type LayoutResponse =
  { id: number; layout: CoursesLayout } | { id: number; error: string };

/**
 * Раскладка dagre в отдельном потоке: на графе в сотни уроков она занимает
 * десятки–тысячи миллисекунд и не должна блокировать интерфейс.
 */
self.onmessage = ({ data }: MessageEvent<LayoutRequest>) => {
  const { id, blocks, edges } = data;
  try {
    self.postMessage({
      id,
      layout: layoutCourses(blocks, edges),
    } satisfies LayoutResponse);
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    self.postMessage({ id, error } satisfies LayoutResponse);
  }
};
