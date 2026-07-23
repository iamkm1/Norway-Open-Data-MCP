/**
 * Redaction applied to every byte this server emits — tool results, tool
 * errors and stderr diagnostics alike.
 *
 * Two mechanisms are combined. Configured secret *values* are matched literally,
 * so a credential is caught wherever it surfaces regardless of how it got there.
 * Credential-shaped *patterns* catch values this process never held, such as an
 * `Authorization` header echoed back inside a provider error message.
 *
 * Deliberately not redacted: `https://` and `http://` URLs. Provider homepages,
 * documentation links and licence URLs are attribution the brief requires us to
 * preserve, and none of them are secrets.
 */

const PLACEHOLDER = "[redacted]";
const PATH_PLACEHOLDER = "[path]";

/** Header and token shapes that must never reach a client or a log file. */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // Authorization: Bearer <token> / Basic <token>
  /\b(authorization\s*[:=]\s*)(?:bearer|basic|token)?\s*[A-Za-z0-9._~+/=-]{8,}/gi,
  // x-api-key: <value>, api-key=<value>, apiKey: "<value>"
  /\b(x-)?api[-_]?key\s*[:=]\s*"?[A-Za-z0-9._~+/=-]{8,}"?/gi,
  // cookie / set-cookie payloads
  /\b(set-)?cookie\s*[:=]\s*[^\s;,]{4,}/gi,
];

/**
 * Local filesystem shapes. Kept narrow so that provider URLs and ordinary
 * prose survive untouched.
 */
const PATH_PATTERNS: readonly RegExp[] = [
  /file:\/\/\/?[^\s"'`)]+/gi,
  /\b[A-Za-z]:[\\/](?:[^\s"'`<>|]*)/g,
  /(?:^|\s)\/(?:home|Users|root|var|tmp|opt|usr|private|mnt)\/[^\s"'`)]*/g,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Redactor {
  readonly #secrets: readonly RegExp[];

  /**
   * @param secrets Literal secret values held by this process. Short values are
   * ignored: a one- or two-character "secret" would match everywhere and turn
   * legitimate output into noise.
   */
  constructor(secrets: readonly (string | undefined)[] = []) {
    this.#secrets = secrets
      .filter((value): value is string => typeof value === "string" && value.trim().length >= 4)
      .map((value) => new RegExp(escapeRegExp(value.trim()), "gi"));
  }

  /** Redacts a single string. */
  text(value: string): string {
    let output = value;
    for (const secret of this.#secrets) output = output.replace(secret, PLACEHOLDER);
    for (const pattern of CREDENTIAL_PATTERNS) output = output.replace(pattern, PLACEHOLDER);
    for (const pattern of PATH_PATTERNS) {
      output = output.replace(pattern, (match) =>
        match.startsWith(" ") ? ` ${PATH_PLACEHOLDER}` : PATH_PLACEHOLDER,
      );
    }
    return output;
  }

  /**
   * Redacts every string inside a JSON-compatible value, preserving structure.
   * Cycles are broken rather than throwing, because this runs on the way out
   * and must never itself become a failure mode.
   */
  value<T>(input: T): T {
    return this.#walk(input, new WeakSet<object>()) as T;
  }

  /**
   * `seen` tracks the current *ancestor path*, not every node ever visited, and
   * entries are removed on the way back up.
   *
   * A permanent visited-set would misclassify a shared reference as a cycle:
   * a tool that puts the same array in two places — as several legitimately do
   * — would have its second occurrence replaced by a string, producing output
   * that no longer matches the declared schema. Only a genuine ancestor
   * reference is a cycle.
   */
  #walk(input: unknown, seen: WeakSet<object>): unknown {
    if (typeof input === "string") return this.text(input);
    if (input === null || typeof input !== "object") return input;

    if (seen.has(input)) return "[circular]";
    seen.add(input);

    try {
      if (Array.isArray(input)) return input.map((item) => this.#walk(item, seen));

      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) {
        output[this.text(key)] = this.#walk(item, seen);
      }
      return output;
    } finally {
      seen.delete(input);
    }
  }
}

/** A redactor holding no secrets, for contexts where none are configured. */
export const passthroughRedactor = new Redactor();
