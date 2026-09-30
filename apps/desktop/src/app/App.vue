<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import type {
  BatchDto,
  CourseDto,
  Grade,
  RecordResultDto,
} from '@lms/engine-contract';
import { ENGINE_KEY } from './engine/keys.ts';
import { useDue } from './engine/use-due.ts';

const GRADES: Grade[] = [1, 2, 3, 4, 5];

const engine = inject(ENGINE_KEY);
if (!engine) throw new Error('engine is not provided');

const courses = ref<CourseDto[]>([]);
const batch = ref<BatchDto | null>(null);
const lastResult = ref<RecordResultDto | null>(null);
const error = ref<string | null>(null);
const { items: due } = useDue(engine);

const guarded = async (action: () => Promise<void>) => {
  error.value = null;
  try {
    await action();
  } catch (caught) {
    error.value = String(caught);
  }
};

const loadBatch = () =>
  guarded(async () => {
    batch.value = await engine.practice.getBatch();
  });

const record = (exerciseId: string, grade: Grade) =>
  guarded(async () => {
    lastResult.value = await engine.practice.recordAttempt({
      requestId: crypto.randomUUID(),
      exerciseId,
      grade,
    });
  });

onMounted(() =>
  guarded(async () => {
    courses.value = (await engine.library.listCourses()).items;
  }),
);
</script>

<template>
  <main>
    <h1>LMS</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <section>
      <h2>Курсы</h2>
      <ul>
        <li v-for="course in courses" :key="course.id">
          {{ course.name }} ({{ course.lessonCount }})
        </li>
      </ul>
    </section>

    <section>
      <h2>Упражнения</h2>
      <button type="button" @click="loadBatch">Получить батч</button>
      <ol v-if="batch">
        <li v-for="exercise in batch.exercises" :key="exercise.id">
          {{ exercise.name }}
          <button
            v-for="grade in GRADES"
            :key="grade"
            type="button"
            @click="record(exercise.id, grade)"
          >
            {{ grade }}
          </button>
        </li>
      </ol>
      <p v-if="lastResult">
        Записано: {{ lastResult.exerciseId }}, оценка {{ lastResult.grade }}
        <span v-if="lastResult.duplicate">(повтор)</span>
      </p>
    </section>

    <section>
      <h2>К повторению</h2>
      <ul>
        <li v-for="item in due" :key="item.exerciseId">
          {{ item.exerciseId }} — R {{ item.retrievability.toFixed(2) }}
        </li>
      </ul>
    </section>
  </main>
</template>
