import { describe, expect, it } from "vitest";

import type { DeepgramResult } from "../deepgram/client";
import { SegmentBuffer } from "./segment-buffer";

const result = (overrides: Partial<DeepgramResult>): DeepgramResult => ({
  transcript: "",
  isFinal: true,
  speechFinal: false,
  fromFinalize: false,
  startMs: 0,
  endMs: 1_000,
  ...overrides,
});

describe("SegmentBuffer", () => {
  it("joins final chunks until speech is complete", () => {
    const buffer = new SegmentBuffer();

    expect(buffer.append(result({ transcript: "Grace is", endMs: 1_000 }))).toBeUndefined();
    expect(
      buffer.append(
        result({ transcript: "freely given", startMs: 1_000, endMs: 2_000, speechFinal: true }),
      ),
    ).toEqual({ source: "Grace is freely given", startMs: 0, endMs: 2_000 });
  });

  it("ignores interim text and flushes on punctuation", () => {
    const buffer = new SegmentBuffer();

    expect(buffer.append(result({ transcript: "changing", isFinal: false }))).toBeUndefined();
    expect(buffer.append(result({ transcript: "Christ is risen." }))).toEqual({
      source: "Christ is risen.",
      startMs: 0,
      endMs: 1_000,
    });
  });

  it("flushes a long phrase after seven seconds", () => {
    const buffer = new SegmentBuffer();

    expect(buffer.append(result({ transcript: "In the beginning", endMs: 2_000 }))).toBeUndefined();
    expect(
      buffer.append(result({ transcript: "God created", startMs: 2_000, endMs: 7_000 })),
    ).toEqual({
      source: "In the beginning God created",
      startMs: 0,
      endMs: 7_000,
    });
  });

  it("flushes on Chinese and Japanese sentence punctuation", () => {
    const buffer = new SegmentBuffer();

    expect(buffer.append(result({ transcript: "神的恩典够我们用。" }))).toEqual({
      source: "神的恩典够我们用。",
      startMs: 0,
      endMs: 1_000,
    });
    expect(buffer.append(result({ transcript: "恵みは十分です！" }))).toEqual({
      source: "恵みは十分です！",
      startMs: 0,
      endMs: 1_000,
    });
  });
});