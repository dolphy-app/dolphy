/**
 * Запросы хоста движка к main за возможностями платформы (`PlatformServices`
 * движка): `safeStorage` и `Notification` есть только в main, а хост движка — `utilityProcess`
 * с единственным каналом `process.parentPort`. Сообщения идут по нему же:
 * хост → main `platform-request`, main → хост `platform-response`.
 *
 * Открытый текст и шифртекст (base64) проходят только в `params` и `result`;
 * отказ несёт код без текста: сообщения платформы секретов не раскрывают.
 * `notify` показывает системное уведомление, текст которого движок уже проверил
 * (чистый текст в пределах длин, лимиты и переключатель — на его стороне);
 * результат — показано ли оно (`false` — ОС уведомления не поддерживает).
 */
export type PlatformRequest = { type: 'platform-request'; id: string } & (
  | { op: 'cipher.available' }
  | { op: 'cipher.encrypt'; plaintext: string }
  | { op: 'cipher.decrypt'; ciphertext: string }
  | { op: 'notify'; source: string; title: string; body: string }
);

export type PlatformOp = PlatformRequest['op'];

/** `UNAVAILABLE` — хранилища ключей нет или оно не справилось; `INVALID` — запрос неверной формы. */
export type PlatformFailureCode = 'UNAVAILABLE' | 'INVALID';

export type PlatformResponse =
  | {
      type: 'platform-response';
      id: string;
      ok: true;
      result: boolean | string;
    }
  | {
      type: 'platform-response';
      id: string;
      ok: false;
      code: PlatformFailureCode;
    };

/** Срок ответа main на запрос платформы, мс. */
export const PLATFORM_REQUEST_MS = 5000;

export const isPlatformResponse = (
  message: unknown,
): message is PlatformResponse =>
  typeof message === 'object' &&
  message !== null &&
  (message as { type?: unknown }).type === 'platform-response' &&
  typeof (message as { id?: unknown }).id === 'string' &&
  typeof (message as { ok?: unknown }).ok === 'boolean';
