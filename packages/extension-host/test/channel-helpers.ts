import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import { createHostChannel } from '../src/channel.ts';
import type { HostChannel, HostChannelOptions } from '../src/channel.ts';
import type { ReplaceExtensionsRequest } from '../src/protocol.ts';

/** Канал без расширений: после каждого `attach` итог регистрации игнорируется. */
export const createBareChannel = (
  options: Pick<HostChannelOptions, 'logger'> & Partial<HostChannelOptions>,
): HostChannel =>
  createHostChannel({
    currentExtensions: () => [],
    onRegistrations: () => {},
    ...options,
  });

/** Сообщение канала хосту с набором кандидатов, который канал шлёт после каждого `attach`. */
export const isReplaceRequest = (
  message: unknown,
): message is ReplaceExtensionsRequest =>
  typeof message === 'object' &&
  message !== null &&
  'method' in message &&
  message.method === 'replaceExtensions';

/**
 * Хост принимает набор кандидатов без вкладов: на запрос `replaceExtensions`
 * отвечает пустым итогом. `true` — сообщение было таким запросом.
 */
export const answerReplace = (
  host: MessageEndpoint,
  message: unknown,
): boolean => {
  if (!isReplaceRequest(message)) return false;
  host.post({ id: message.id, ok: true, result: { registrations: {} } });
  return true;
};
