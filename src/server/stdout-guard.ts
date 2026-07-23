/**
 * Protects the MCP protocol stream from accidental stdout writes.
 *
 * The stdio transport frames JSON-RPC on stdout. A single stray `console.log`
 * — in this package, in a dependency, or in a future change — inserts a
 * non-JSON line into that stream and the client drops the connection with a
 * parse error that is very hard to trace back to its cause.
 *
 * Lint rules catch the cases we own. This catches the rest at runtime: the
 * real `write` is captured and handed only to the transport, while the public
 * `process.stdout.write` is replaced with a function that diverts everything
 * else to stderr and reports it.
 *
 * This is defence in depth, not a licence to log to stdout.
 */

import { Writable } from "node:stream";

import type { Logger } from "../logging/logger.js";

export type StdoutGuard = {
  /** The genuine stdout writer, reserved for the transport. */
  protocolStream: Writable;
  /** Number of writes diverted. Asserted by the protocol tests. */
  divertedCount(): number;
  /** Restores the original `process.stdout.write`. */
  release(): void;
};

/**
 * @param logger Receives a warning for every diverted write.
 */
export function installStdoutGuard(logger: Logger): StdoutGuard {
  const stdout = process.stdout;
  // Captured unbound on purpose, so `release()` restores the exact original
  // reference. Binding here would restore a wrapper instead, and repeated
  // install/release cycles would stack a new bind each time. `this` is
  // re-supplied explicitly by `callOriginal` below, so the usual unbound-method
  // hazard does not apply.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalWrite = stdout.write;
  const callOriginal = (chunk: string | Uint8Array, encoding?: BufferEncoding): boolean =>
    (originalWrite as (this: typeof stdout, ...args: unknown[]) => boolean).call(
      stdout,
      chunk,
      encoding,
    );
  let diverted = 0;
  let released = false;

  /**
   * A real `Writable` over the captured `write`. The transport holds this, so
   * protocol frames bypass the guard entirely and cannot be diverted even if
   * something replaces `process.stdout.write` again later.
   *
   * `decodeStrings: false` keeps the already-serialized JSON-RPC frames as
   * strings rather than round-tripping them through Buffers.
   */
  const protocolStream = new Writable({
    decodeStrings: false,
    write(chunk: string | Uint8Array, encoding, callback) {
      try {
        callOriginal(chunk, encoding);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error("stdout write failed"));
      }
    },
    // The process owns stdout's lifetime; closing the transport must not close it.
    final(callback) {
      callback();
    },
  });

  const guardedWrite = (
    chunk: string | Uint8Array,
    encoding?: unknown,
    callback?: unknown,
  ): boolean => {
    diverted += 1;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    logger.warn("Blocked a non-protocol write to stdout; diverted to stderr.", {
      preview: text.slice(0, 200),
    });
    if (typeof encoding === "function") (encoding as () => void)();
    else if (typeof callback === "function") (callback as () => void)();
    return true;
  };

  (stdout as unknown as { write: unknown }).write = guardedWrite;

  return {
    protocolStream,
    divertedCount: () => diverted,
    release: () => {
      if (released) return;
      released = true;
      (stdout as unknown as { write: unknown }).write = originalWrite;
    },
  };
}
