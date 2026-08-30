import type { DeepgramResult } from "../deepgram/client";

export interface BufferedSegment {
  source: string;
  startMs: number;
  endMs: number;
}

export class SegmentBuffer {
  private parts: string[] = [];
  private startMs = 0;
  private endMs = 0;

  append(result: DeepgramResult): BufferedSegment | undefined {
    if (!result.isFinal) return undefined;

    if (this.parts.length === 0) this.startMs = result.startMs;
    this.parts.push(result.transcript);
    this.endMs = result.endMs;

    const source = this.parts.join(" ").replace(/\s+/g, " ").trim();
    const elapsed = this.endMs - this.startMs;
    const shouldFlush =
      result.speechFinal ||
      result.fromFinalize ||
      /[.!?。！？]$/.test(source) ||
      elapsed >= 7_000 ||
      source.length >= 120;

    return shouldFlush ? this.flush() : undefined;
  }

  flush(): BufferedSegment | undefined {
    if (this.parts.length === 0) return undefined;

    const segment = {
      source: this.parts.join(" ").replace(/\s+/g, " ").trim(),
      startMs: this.startMs,
      endMs: this.endMs,
    };
    this.parts = [];
    this.startMs = 0;
    this.endMs = 0;
    return segment;
  }
}