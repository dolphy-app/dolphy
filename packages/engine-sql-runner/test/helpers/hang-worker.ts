// Раннер-заглушка: сообщает `ready` и молчит на любые запросы (тест «молчание дольше timeoutMs + grace»).
process.send?.({
  type: 'ready',
  driver: 'better-sqlite3',
  profile: 'fallback',
});
process.on('message', () => {});
setInterval(() => {}, 1 << 30);
