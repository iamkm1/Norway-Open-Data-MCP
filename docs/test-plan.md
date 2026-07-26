# Test plan

No test in the default suite touches a live public API. Every layer is
dependency-injected: the server factory accepts a `NorwayOpenDataLike` object,
so tools are exercised against fakes that return exactly the shapes the real SDK
declares.

## Layers

| Suite                | Location                                         | Runs in CI            | Network                     |
| -------------------- | ------------------------------------------------ | --------------------- | --------------------------- |
| Unit                 | `tests/unit/**`                                  | yes                   | none                        |
| Protocol integration | `tests/integration/**`                           | yes                   | none (spawns built binary)  |
| Package              | `tests/package/**` via `scripts/test-package.ts` | yes                   | npm pack only, no providers |
| Routing evaluation   | `tests/eval/**`                                  | structural check only | none                        |
| Live                 | `tests/live/**`                                  | **opt-in only**       | yes, bounded                |

## Unit tests — per tool

Each of the twenty-eight tools is tested for the full matrix required by the
brief:

1. valid request
2. minimum input (only required fields)
3. maximum input (every field at its hard limit)
4. invalid input (each rejection rule: blank, NaN, Infinity, negative, oversized,
   bad enum, reversed date range, unknown property)
5. empty result
6. one result
7. multiple results
8. truncated result — asserts both the structural `truncation` entry and the
   prose warning
9. provider error
10. rate limit — asserts `retryAfter` survives
11. timeout
12. cancellation — asserts the abort signal reached the SDK call
13. missing configuration — asserts the exact env-var name appears
14. attribution — asserts `sources[]` matches the provider registry exactly
15. structured output — asserts it validates against the declared `outputSchema`
16. text fallback — asserts deterministic, non-empty, budget-respecting text

Items 12 and 13 are **registry-driven**: `tests/unit/cancellation.test.ts`
iterates `allTools`, so a tool added later that forgets to forward `{ signal }`
fails automatically rather than being silently uncovered.

## Maritime tests

The maritime tools add failure modes the earlier tools do not have, so they get
two dedicated files.

`tests/unit/maritime-tools.test.ts` covers registration (all eight present
exactly once, the original twelve unchanged in name **and order**), SDK
delegation (each tool calls the method the SDK declares, with the parameters it
declares), credential gating (both variables named, only the missing half named
when one is set, and the anonymous registers working with an empty config),
input validation, partial-profile provenance, and redaction of a client secret
and bearer token echoed back inside a provider error.

`tests/unit/live-vessel-positions.test.ts` covers the bounded stream. Its fake
feed is finite or abort-driven and records whether the consumer released the
iterator, so every test asserts **both** that the tool returned and that the
connection was closed:

- stops at the limit and releases the iterator while the timeout is still 10 s
  away — proving the release is caused by the limit, not by the timeout;
- returns a partial sample on timeout rather than hanging, and an empty sample
  for a quiet area, which is a success and not an error;
- closes on caller cancellation and reports `cancelled`, not a provider failure;
- surfaces a genuine provider error rather than swallowing it as a timeout;
- refuses every request missing any of the three mandatory bounds, and refuses
  inverted, antimeridian-crossing, non-finite and oversized boxes — asserting in
  each case that **no stream was opened**.

Timeouts in these tests are hundreds of milliseconds, so the suite stays fast and
fully deterministic offline.

## Geospatial tests

`tests/unit/geospatial-tools.test.ts` covers the eight geospatial tools as a set,
because their failure modes are shared rather than per-tool:

- **Spatial input validation.** `NaN`, `+Infinity` and `-Infinity` latitude and
  longitude, and out-of-range values, are refused for every point tool — and the
  test asserts **no provider method was called at all**. Bounding boxes are
  refused when `north` is not above `south`, when the box crosses the
  antimeridian (which the SDK does not support), and when it exceeds this
  server's 2° × 4° span cap; the error text must say whose limit it is. A box
  exactly at the cap is accepted, so the boundary is pinned from both sides.
- **Limit enforcement.** Each tool's ceiling, plus zero, negative and fractional
  limits, are refused. One test asserts the caller's limit reaches the SDK and
  that `maxPages` bounds provider requests — and that `pageSize` is **not**
  forwarded, which is a regression guard: overriding it with the caller's limit
  made Miljødirektoratet's WFS return a page the SDK rejected.
- **The intervention-free minimum limit.** A limit of 1 is refused with a clear
  message, a limit of 2 succeeds, and the composed profile carries the same floor.
- **SDK delegation.** Every tool is driven once and each SDK method's call count
  asserted, so a tool wired to the wrong method fails. `includeProposed: false`
  must not call the proposal method at all.
- **Empty and truncated results.** An empty protected-area result must carry the
  "not evidence that no species, habitat, environmental interest…" warning in the
  structured envelope _and_ "not an environmental clearance" in the rendered
  text. A truncated page must report `truncated`, `hasMore` and `nextOffset` from
  the SDK, offer a continuation, and warn that it is not a complete inventory; a
  complete page must claim none of that.
- **Geometry.** Off by default with the shape still reported; a polygon returned
  with its **interior ring intact**, ring for ring; a multipolygon returned with
  **every part** including a part's hole; a provider's null geometry handled
  without losing attributes; an oversized geometry dropped **whole** — attributes
  untouched, `truncation` set, warning naming the vertex ceiling; and the
  result-wide vertex budget refusing later geometries while keeping every feature.
- **Attribution.** Naturbase's NLOD notice, the intervention-free layer's own
  NLOD 1.0 wording, NIBIO's `Kilde: NIBIO.` and Geonorge's Kartverket credit are
  each asserted verbatim, in the envelope and in the rendered footer.
- **The nature profile.** All sections present; every real provider credited and
  the synthetic composite absent from `sources`; **two** Naturbase entries when
  their licence terms differ; the composite preserved as `compositeSource` with no
  licence field; a provider failure leaving successful sections intact with
  `null` (not `[]`) for the failed ones, `partial.missing` naming them and the
  SDK's own message preserved; per-section pagination; and every dataset caveat.
- **Sparse payloads.** A protected area, proposed area, nature locality, AR50
  polygon, catalogue hit, catalogue record and nature profile each stripped to
  their required fields only, asserting the rendered text never contains
  `undefined` and that conditional warnings are absent when their condition is.
- **Projection and privacy.** `landTypeCode` labelled from the SOSI list, the
  other four codes returned undecoded, an unknown code left unlabelled rather
  than guessed, and Geonorge contacts reduced to organizations with the named
  individual and e-mail address absent from the whole serialized result.
- **Error mapping.** A Naturbase 503 → retryable `provider_error`; an unknown
  catalogue id → non-retryable `not_found`; a failed current-protection lookup
  failing the call, while a failed _proposal_ lookup returns a partial result.

Cancellation and no-URL coverage live with the registry-driven suites: the
geospatial tools are picked up automatically by `tests/unit/cancellation.test.ts`,
and `tests/unit/server-contract.test.ts` asserts that **no tool anywhere**
advertises an input property whose name looks like a URL, host, endpoint, service,
WFS/WMS/OGC/ArcGIS reference, type name or layer name.

## Shared-behaviour tests

- **Envelope**: source de-duplication, newest `retrievedAt`, `cached` only when
  every underlying response was cached, and — because one provider id can publish
  two sets of terms — that two sources sharing an id but differing in licence or
  required attribution are both kept rather than de-duplicated to one.
- **Limits**: leading-slice determinism, string clamping, array backstop,
  serialized-size guard with progressive halving, and the invariant that
  truncation is always reported.
- **Error mapping**: every SDK error class → expected code/retryable, and that
  no mapped error contains a stack trace, absolute path, api key or email.
- **Redaction**: property-style test feeding a configured secret through each
  output path and asserting it never appears.
- **Config**: defaults, overrides, invalid values, and that a bad value produces
  a tool-level `missing_configuration` rather than a process exit.
- **Lifecycle**: SIGINT/SIGTERM/stdin-close each trigger exactly one graceful
  shutdown; double signals are idempotent.
- **stdout guard**: a `console.log` inside a handler is diverted to stderr and
  does not reach stdout.

## Protocol integration

Spawns the **built** `dist/cli.js` as a real subprocess and drives it with the
official MCP `Client` over `StdioClientTransport`:

- initialization handshake and server identity (name, version)
- advertised capabilities
- `tools/list` — asserts the **exact tool count matches
  `EXPECTED_TOOL_COUNT`** and that names, titles, descriptions and input schemas
  are present and non-empty
- the twenty pre-geospatial tools are still the **first twenty**, in their
  original order, with the eight geospatial tools appended
- every geospatial tool is advertised with a strict schema, an output schema and
  read-only annotations
- an out-of-range coordinate, an over-large limit, an inverted box, a
  country-sized box, an unfiltered catalogue search and a URL passed as a
  catalogue identifier are each refused over real stdio
- no two tool descriptions are near-duplicates (token-overlap check)
- `tools/call` success path
- `tools/call` error path returns `isError: true`, not a transport error
- cancellation mid-request
- clean shutdown on close
- **every byte of stdout parses as JSON-RPC** — the corruption test
- stderr output during a call does not desynchronise the protocol

## Package tests

`scripts/test-package.ts`:

1. `npm pack` in a clean tree
2. assert the tarball contains no tests, fixtures, `.env`, coverage, source maps
   of sources, or repository config
3. install the tarball into a fresh temp directory **outside** the repository
4. run the installed binary's `--version` and `--doctor`
5. spawn the installed binary as an MCP server and list tools
6. import the package entry point and assert `createNorwayOpenDataMcpServer` and
   the type declarations resolve
7. assert nothing resolves back into the repository

## Routing evaluation corpus

`tests/eval/tool-routing.json` — at least 40 realistic questions in Norwegian
and English. Each case records: `question`, `expectedTool`, `mustNotSelect[]`,
`reason`, `requiredArguments`, and `expectedClarification` when information is
missing.

CI runs a **structural** test only: every `expectedTool` and `mustNotSelect`
entry names a tool that actually exists, required arguments validate against
that tool's input schema, and every documented ambiguity pair is covered. Actual
model-based evaluation is opt-in and needs no API key to be present in CI.

## Live tests

`pnpm test:live` only, never in the default pipeline. Bounded to a handful of
requests against open, credential-free providers, with assertions on shape
rather than on values that change. Designed never to approach a provider budget;
skipped automatically when identification is not configured.

Every geospatial tool has a live case, all against anonymous services and all
needing no new credential:

- Geonorge dataset search, and a metadata fetch **chained off that search** rather
  than pinned to a hard-coded UUID, so the case cannot rot when Kartverket
  retires a record. The live record is asserted to carry no `email` field.
- Naturbase protected areas at Galdhøpiggen — where a match is expected but an
  empty result is tolerated — asserting geometry stays off by default, that
  Miljødirektoratet's licence and attribution survive the live path, and that the
  "not evidence that no species…" caveat is present.
- Real live geometry with `includeGeometry: true`: either the coordinates arrive
  and their ring or part count matches `geometrySummary`, or the omission is
  explained. Either way the payload is asserted to stay inside the 120,000-char
  budget.
- A bounded protected-area bounding-box search, asserting `hasMore` equals
  `truncated`.
- A nature-locality lookup that may legitimately be empty, a live
  intervention-free lookup asserting the zone codes are `1`/`2`/`v`, the status
  date is `2023-01` and the layer's **own** attribution wording is returned, and a
  live AR50 lookup asserting `Kilde: NIBIO.`
- A live composed nature profile asserting that the synthetic composite source is
  present as data but absent from `sources`, and that every credited provider has
  both a licence and an attribution.
- Two negative cases against the live server: a country-sized bounding box
  refused **locally**, verified by elapsed time too short for a round trip, and a
  service URL refused where a catalogue identifier belongs.

## Coverage thresholds

Enforced globally at 85% lines / 85% functions / 80% branches, with the
release-critical modules held higher:

| Path                | Lines |
| ------------------- | ----- |
| `src/tools/**`      | 90%   |
| `src/errors/**`     | 95%   |
| `src/limits/**`     | 95%   |
| `src/config/**`     | 90%   |
| `src/formatting/**` | 90%   |

`src/cli/**` and `src/server/transport.ts` are covered by the subprocess
integration suite rather than by unit tests; they are excluded from the unit
coverage denominator and asserted behaviourally instead.
