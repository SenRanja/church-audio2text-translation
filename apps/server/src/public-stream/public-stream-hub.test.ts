import { describe, expect, it, vi } from "vitest";

import { PublicStreamHub } from "./public-stream-hub";

describe("PublicStreamHub", () => {
  it("isolates users and ignores events from replaced sessions", () => {
    const hub = new PublicStreamHub();
    const kevin = vi.fn();
    const jayd = vi.fn();
    hub.subscribe("FOCUS-Kevin", ["en", "zh-Hans"], kevin);
    hub.subscribe("FOCUS-Jayd", ["ja", "ko"], jayd);

    hub.start("FOCUS-Kevin", "session-one", "en-AU", ["en", "zh-Hans", "id"]);
    hub.publish("FOCUS-Kevin", "session-one", {
      type: "transcript.final",
      segmentId: "segment-one",
      sequence: 1,
      source: "Grace and peace.",
      startMs: 0,
      endMs: 1_000,
    });
    hub.publish("FOCUS-Kevin", "session-one", {
      type: "translation.final",
      segmentId: "segment-one",
      sequence: 1,
      source: "Grace and peace.",
      translations: { en: "Grace and peace.", "zh-Hans": "恩典与平安。", id: "Kasih karunia dan damai." },
      startMs: 0,
      endMs: 1_000,
    });

    expect(kevin.mock.calls.at(-1)?.[0]).toEqual({
      type: "segment",
      segment: expect.objectContaining({ state: "complete" }),
    });
    expect(jayd).toHaveBeenCalledTimes(1);

    hub.start("FOCUS-Kevin", "session-two", "zh-HK", ["en"]);
    hub.end("FOCUS-Kevin", "session-one");
    expect(kevin.mock.calls.at(-1)?.[0]).toEqual({
      type: "snapshot",
      snapshot: expect.objectContaining({ sessionId: "session-two" }),
    });

    hub.end("focus-kevin", "session-two");
    expect(kevin.mock.calls.at(-1)?.[0]).toEqual({ type: "offline" });
  });

  it("deduplicates viewer languages and removes demand on disconnect", () => {
    const hub = new PublicStreamHub();
    const disconnectFirst = hub.subscribe("FOCUS-Jayd", ["en"], vi.fn());
    const disconnectSecond = hub.subscribe("focus-jayd", ["zh-Hans", "id"], vi.fn());

    expect(hub.getRequestedLanguages("FOCUS-JAYD")).toEqual(["en", "zh-Hans", "id"]);
    disconnectFirst();
    expect(hub.getRequestedLanguages("FOCUS-Jayd")).toEqual(["zh-Hans", "id"]);
    disconnectSecond();
    expect(hub.getRequestedLanguages("FOCUS-Jayd")).toEqual([]);
  });
});