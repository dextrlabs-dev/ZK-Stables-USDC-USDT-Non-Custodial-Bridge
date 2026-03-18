/**
 * serialize-error@8 is CJS (`module.exports = { serializeError, deserializeError }`);
 * @cardano-sdk uses named ESM imports.
 */
import * as ns from '../../../node_modules/serialize-error/index.js';

const m = ns as { serializeError: (e: unknown) => unknown; deserializeError: (v: unknown, o?: object) => Error };

export const serializeError = m.serializeError;
export const deserializeError = m.deserializeError;
