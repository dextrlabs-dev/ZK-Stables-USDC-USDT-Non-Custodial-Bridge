/** Minimal `assert` default for browser — @subsquid/scale-codec uses `(0, assert_1.default)(cond, msg)`. */
export default function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed');
  }
}
