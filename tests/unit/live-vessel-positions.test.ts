/**
 * The bounded live-feed tool.
 *
 * `sdk.ais.streamPositions()` never ends on its own. This file is the proof
 * that no MCP caller can ever observe that: every test asserts both that the
 * tool returned, and that the iterator was released.
 *
 * All fakes are finite or abort-driven, so the suite is deterministic and runs
 * entirely offline. Timeouts are hundreds of milliseconds, not seconds, so a
 * timeout test costs the suite almost nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AisPosition } from "norway-open-data-sdk";

import { createHarness, type Harness } from "../helpers/harness.js";
import {
  createFakeStream,
  createFakeSdk,
  sampleAisPositions,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import type { ServerConfig } from "../../src/config/types.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const AIS_CONFIG: Partial<ServerConfig> = {
  barentswatchAisClientId: "bw-ais-client-id",
  barentswatchAisClientSecret: "bw-ais-client-secret",
};

const BOX = { south: 63.3, west: 10.2, north: 63.6, east: 10.7 };

describe("bounded stream consumption", () => {
  it("stops at the limit and releases the iterator, even though the feed never ends", async () => {
    // Five positions available, then an endless wait: the shape of the real feed.
    const fake = createFakeStream(sampleAisPositions, { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 3,
      timeoutMs: 10_000,
    });

    expect(envelope.data["positionCount"]).toBe(3);
    expect(envelope.data["stoppedBecause"]).toBe("limit-reached");
    // The connection must be released the moment the limit is hit, not at the
    // timeout — which is 10 seconds away and would have failed this test.
    expect(fake.closed(), "the iterator was not released at the limit").toBe(true);
    expect(envelope.truncation?.truncated).toBe(true);
  });

  it("counts distinct vessels and never exceeds the requested limit", async () => {
    const fake = createFakeStream(sampleAisPositions, { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 5,
      timeoutMs: 10_000,
    });

    const positions = envelope.data["positions"] as { mmsi: string }[];
    expect(positions).toHaveLength(5);
    expect(envelope.data["vesselCount"]).toBe(5);
    expect(fake.closed()).toBe(true);
  });

  it("returns what it has when the feed ends before the limit", async () => {
    // Finite and not endless: the stream itself completes.
    const fake = createFakeStream(sampleAisPositions.slice(0, 2));
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 50,
      timeoutMs: 10_000,
    });

    expect(envelope.data["positionCount"]).toBe(2);
    expect(envelope.data["stoppedBecause"]).toBe("stream-ended");
    expect(envelope.truncation).toBeNull();
    expect(fake.closed()).toBe(true);
  });
});

describe("timeout", () => {
  it("returns a partial sample rather than hanging when the feed goes quiet", async () => {
    // Two positions, then silence forever. Only the timeout can end this.
    const fake = createFakeStream(sampleAisPositions.slice(0, 2), { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const started = Date.now();
    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 100,
      timeoutMs: 600,
    });
    const elapsed = Date.now() - started;

    expect(envelope.data["stoppedBecause"]).toBe("timeout");
    expect(envelope.data["positionCount"]).toBe(2);
    // It waited for the timeout, and did not wait appreciably beyond it.
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(6_000);
    expect(fake.closed(), "the iterator was not released at the timeout").toBe(true);
  });

  it("succeeds with an empty sample when a quiet area emits nothing at all", async () => {
    const fake = createFakeStream([], { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 10,
      timeoutMs: 600,
    });

    // A quiet area is an answer, not a failure.
    expect(envelope.data["positionCount"]).toBe(0);
    expect(envelope.data["stoppedBecause"]).toBe("timeout");
    expect(envelope.warnings.join(" ")).toContain("No AIS position was received");
    expect(envelope.text).toContain("No positions were received");
    expect(fake.closed()).toBe(true);
  });

  it("reports how long the connection was actually held open", async () => {
    const fake = createFakeStream([], { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 10,
      timeoutMs: 700,
    });

    const sampledForMs = envelope.data["sampledForMs"] as number;
    expect(sampledForMs).toBeGreaterThanOrEqual(600);
    expect(sampledForMs).toBeLessThan(6_000);
  });
});

describe("cancellation", () => {
  it("closes the stream and reports cancellation when the caller aborts", async () => {
    const fake = createFakeStream([], { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      {
        name: "get_live_vessel_positions",
        arguments: { boundingBox: BOX, limit: 50, timeoutMs: 15_000 },
      },
      undefined,
      { signal: controller.signal },
    );

    // The stream must be open before the abort, or the test proves nothing.
    await vi.waitFor(() => expect(fake.lastParameters()?.signal).toBeInstanceOf(AbortSignal));
    expect(fake.closed()).toBe(false);

    controller.abort();
    await expect(pending).rejects.toThrow();

    // The abort reached the SDK's own signal and released the connection —
    // 15 seconds before the timeout would have.
    await vi.waitFor(() => expect(fake.closed()).toBe(true));
    expect(fake.lastParameters()?.signal?.aborted).toBe(true);
  });

  it("does not leak the tool's timeout controller into an unrelated call", async () => {
    const first = createFakeStream([], { endless: true });
    const second = createFakeStream(sampleAisPositions.slice(0, 1));
    let call = 0;
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          streamPositions: (parameters) => {
            call += 1;
            return call === 1 ? first.stream(parameters) : second.stream(parameters);
          },
        },
      }),
      config: AIS_CONFIG,
    });

    const [a, b] = await Promise.all([
      harness.callOk("get_live_vessel_positions", {
        boundingBox: BOX,
        limit: 10,
        timeoutMs: 600,
      }),
      harness.callOk("get_live_vessel_positions", {
        boundingBox: BOX,
        limit: 10,
        timeoutMs: 10_000,
      }),
    ]);

    expect(a.data["stoppedBecause"]).toBe("timeout");
    expect(b.data["stoppedBecause"]).toBe("stream-ended");
    expect(b.data["positionCount"]).toBe(1);
  });

  it("surfaces a genuine provider failure rather than swallowing it as a timeout", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          // A connection that fails on the first read, as a 502 from the feed
          // would. Written as a manual iterator because it never yields.
          streamPositions: () => ({
            [Symbol.asyncIterator]: () => ({
              next: (): Promise<IteratorResult<AisPosition>> =>
                Promise.reject(
                  sdkError("ProviderError", "BarentsWatch closed the connection.", {
                    provider: "barentswatch-ais",
                    statusCode: 502,
                  }),
                ),
            }),
          }),
        },
      }),
      config: AIS_CONFIG,
    });

    const error = await harness.callErr("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 10,
      timeoutMs: 10_000,
    });

    expect(error.code).toBe("provider_error");
    expect(error.provider).toBe("barentswatch-ais");
    expect(error.statusCode).toBe(502);
  });
});

describe("delegation and input validation", () => {
  it("passes the box, the MMSI filter, downsampling and a live signal to the SDK", async () => {
    const fake = createFakeStream(sampleAisPositions.slice(0, 1));
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 5,
      timeoutMs: 1000,
      mmsi: ["257123456", "259876543"],
      downsample: false,
    });

    const parameters = fake.lastParameters()!;
    expect(parameters["boundingBox"]).toEqual(BOX);
    expect(parameters["mmsi"]).toEqual(["257123456", "259876543"]);
    expect(parameters["downsample"]).toBe(false);
    expect(parameters["signal"]).toBeInstanceOf(AbortSignal);
  });

  it("asks the provider to downsample by default", async () => {
    const fake = createFakeStream(sampleAisPositions.slice(0, 1));
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 5,
      timeoutMs: 1000,
    });

    expect(fake.lastParameters()!["downsample"]).toBe(true);
  });

  it("requires a bounding box, a limit and a timeout — none of them defaulted", async () => {
    const streamPositions = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions } }),
      config: AIS_CONFIG,
    });

    for (const args of [
      {},
      { limit: 10, timeoutMs: 1000 },
      { boundingBox: BOX, timeoutMs: 1000 },
      { boundingBox: BOX, limit: 10 },
    ]) {
      const result = await harness.call("get_live_vessel_positions", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(streamPositions, "a stream was opened for an invalid request").not.toHaveBeenCalled();
  });

  it("rejects a malformed, inverted, antimeridian-crossing or oversized box", async () => {
    const streamPositions = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions } }),
      config: AIS_CONFIG,
    });

    const boxes = [
      // north below south
      { south: 63.6, west: 10.2, north: 63.3, east: 10.7 },
      // east below west: an antimeridian-crossing box, which no provider here serves
      { south: 63.3, west: 10.7, north: 63.6, east: 10.2 },
      // degenerate
      { south: 63.3, west: 10.2, north: 63.3, east: 10.7 },
      // out of range
      { south: -91, west: 10.2, north: 63.6, east: 10.7 },
      { south: 63.3, west: 10.2, north: 63.6, east: 181 },
      // non-finite
      { south: Number.NaN, west: 10.2, north: 63.6, east: 10.7 },
      // far too large to be a useful sample
      { south: 58, west: 4, north: 71, east: 31 },
      // unknown edge
      { south: 63.3, west: 10.2, north: 63.6, east: 10.7, up: 1 },
    ];

    for (const boundingBox of boxes) {
      const result = await harness.call("get_live_vessel_positions", {
        boundingBox,
        limit: 10,
        timeoutMs: 1000,
      });
      expect(result.isError, JSON.stringify(boundingBox)).toBe(true);
    }
    expect(streamPositions).not.toHaveBeenCalled();
  });

  it("refuses a limit or timeout outside its bounds", async () => {
    const streamPositions = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions } }),
      config: AIS_CONFIG,
    });

    for (const args of [
      { boundingBox: BOX, limit: 0, timeoutMs: 1000 },
      { boundingBox: BOX, limit: -1, timeoutMs: 1000 },
      { boundingBox: BOX, limit: 201, timeoutMs: 1000 },
      { boundingBox: BOX, limit: 1.5, timeoutMs: 1000 },
      // Below the floor, and above the ceiling that bounds how long a tool call
      // may sit on an open connection.
      { boundingBox: BOX, limit: 10, timeoutMs: 100 },
      { boundingBox: BOX, limit: 10, timeoutMs: 60_000 },
      { boundingBox: BOX, limit: 10, timeoutMs: 1000, mmsi: [] },
      { boundingBox: BOX, limit: 10, timeoutMs: 1000, mmsi: ["not-an-mmsi"] },
      { boundingBox: BOX, limit: 10, timeoutMs: 1000, notARealField: true },
    ]) {
      const result = await harness.call("get_live_vessel_positions", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(streamPositions).not.toHaveBeenCalled();
  });

  it("states that the sample is not a census of the area", async () => {
    const fake = createFakeStream(sampleAisPositions, { endless: true });
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: AIS_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 2,
      timeoutMs: 10_000,
    });

    const notes = envelope.warnings.join(" ");
    expect(notes).toContain("bounded sample of a live feed");
    expect(notes).toContain("BarentsWatch AIS coverage is partial");
    expect(notes).toContain("more vessels are almost certainly");
    expect(envelope.sources[0]?.id).toBe("barentswatch-ais");
    expect(envelope.sources[0]?.attribution).toContain("Kystverket");
  });
});
