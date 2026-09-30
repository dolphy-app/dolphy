export interface MessageEndpoint {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export const RPC_METHODS = {
  'library.getInfo': { idempotent: true },
  'library.getDiagnostics': { idempotent: true },
  'library.validate': { idempotent: true },
  'library.compile': { idempotent: false },
  'library.reload': { idempotent: false },
  'library.listCourses': { idempotent: true },
  'library.listLessons': { idempotent: true },
  'library.listExercises': { idempotent: true },
  'library.getUnit': { idempotent: true },
  'library.matchPrefix': { idempotent: true },
  'library.getGraph': { idempotent: true },
  'library.readAsset': { idempotent: true },
  'practice.startSession': { idempotent: false },
  'practice.getBatch': { idempotent: false }, // RNG и счётчик показов
  'practice.beginAttempt': { idempotent: false },
  'practice.submitAnswer': { idempotent: false },
  'practice.completeAttempt': { idempotent: true }, // по attemptId
  'practice.recordAttempt': { idempotent: true }, // по requestId
  'practice.getUnitScore': { idempotent: true },
  'practice.getAttempts': { idempotent: true },
  'practice.getProgress': { idempotent: true },
  'practice.getFrontier': { idempotent: true },
  'practice.getDue': { idempotent: true },
  'practice.resetProgress': { idempotent: true }, // по requestId
  'plan.getDay': { idempotent: true }, // при заданном seed
  'placement.start': { idempotent: false },
  'placement.nextProbe': { idempotent: true }, // до ответа на выданную пробу
  'placement.answer': { idempotent: false },
  'placement.finish': { idempotent: true }, // по requestId
  'placement.abort': { idempotent: false },
  'remediation.getPlan': { idempotent: true },
  'extensions.list': { idempotent: true },
  'extensions.contributions': { idempotent: true },
  'extensions.getSettings': { idempotent: true },
  'extensions.setEnabled': { idempotent: false },
  'extensions.setTrusted': { idempotent: false },
  'curation.blacklist.list': { idempotent: true },
  'curation.blacklist.has': { idempotent: true },
  'curation.blacklist.add': { idempotent: false },
  'curation.blacklist.remove': { idempotent: false },
  'curation.blacklist.removePrefix': { idempotent: false },
  'curation.reviewList.list': { idempotent: true },
  'curation.reviewList.has': { idempotent: true },
  'curation.reviewList.add': { idempotent: false },
  'curation.reviewList.remove': { idempotent: false },
  'curation.reviewList.removePrefix': { idempotent: false },
  'curation.filters.list': { idempotent: true },
  'curation.filters.get': { idempotent: true },
  'curation.filters.save': { idempotent: false },
  'curation.filters.delete': { idempotent: false },
  'curation.sessions.list': { idempotent: true },
  'curation.sessions.get': { idempotent: true },
  'curation.sessions.save': { idempotent: false },
  'curation.sessions.delete': { idempotent: false },
  'settings.getScheduler': { idempotent: true },
  'settings.setScheduler': { idempotent: false },
  'settings.resetScheduler': { idempotent: false },
  'settings.getPreferences': { idempotent: true },
  'settings.setPreferences': { idempotent: false },
  'settings.getScorer': { idempotent: true },
  'settings.getUi': { idempotent: true },
  'settings.setUi': { idempotent: true }, // патч задаёт значения, не приращения
  'settings.getLearning': { idempotent: true },
  'settings.setLearning': { idempotent: true }, // патч задаёт значения, не приращения
  'sync.getState': { idempotent: true },
  'sync.exportSince': { idempotent: true },
  'sync.import': { idempotent: true }, // по id записи
  'sync.rebuild': { idempotent: false },
  'sync.importFromTrane': { idempotent: false },
  'sync.getConflicts': { idempotent: true },
  'sync.resolveConflict': { idempotent: false },
  'sync.folder.configure': { idempotent: false },
  'sync.folder.sync': { idempotent: true }, // по содержимому сегментов
  'sync.folder.checkRestore': { idempotent: false },
  diagnostics: { idempotent: true },
} as const satisfies Record<string, { idempotent: boolean }>;

export type RpcMethodName = keyof typeof RPC_METHODS;

/** Служебные: обрабатывает диспетчер, не движок. */
export const RPC_CONTROL = [
  'engine.hello',
  'events.subscribe',
  'events.unsubscribe',
] as const;
