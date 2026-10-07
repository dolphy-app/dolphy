import {
  EXTENSION_RPC_LIMITS,
  RPC_NAME_PATTERN,
} from '@dolphy-app/extension-api';
import type { RpcContract } from '@dolphy-app/extension-api';

/**
 * `export const sayHello = defineRpc({ name, input, output })`: a typed call
 * between the client and the server part of an extension. Put the contract in a
 * module both parts import; the server answers it with `server.handle`, a
 * component calls it with `useRpc`. Returns `contract` as is; it checks the
 * types and that `name` matches `RPC_NAME_PATTERN` and is at most
 * `EXTENSION_RPC_LIMITS.nameLength` characters. Needs neither Vue nor the
 * engine, so server code imports it.
 */
export const defineRpc = <Input, Output>(
  contract: RpcContract<Input, Output>,
): RpcContract<Input, Output> => {
  const { name } = contract;
  if (
    typeof name !== 'string' ||
    name.length > EXTENSION_RPC_LIMITS.nameLength ||
    !RPC_NAME_PATTERN.test(name)
  ) {
    throw new Error(
      `rpc name '${String(name)}' must match ${RPC_NAME_PATTERN.source} and be at most ${EXTENSION_RPC_LIMITS.nameLength} characters`,
    );
  }
  return contract;
};
