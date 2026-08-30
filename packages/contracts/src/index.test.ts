import { describe, expect, it } from "vitest";

import { clientMessageSchema } from "./index";

describe("clientMessageSchema", () => {
  it("accepts the supported browser audio session", () => {
    expect(
      clientMessageSchema.parse({
        type: "session.start",
        sourceLanguage: "en-AU",
        mimeType: "audio/webm;codecs=opus",
      }),
    ).toEqual({
      type: "session.start",
      sourceLanguage: "en-AU",
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 15,
      targetLanguages: ["en", "zh-Hans", "id"],
    });
  });

  it("accepts every supported source speech language", () => {
    for (const sourceLanguage of ["en-AU", "en-US", "en-GB", "zh-HK", "zh-CN", "ja", "ko-KR", "id"]) {
      expect(
        clientMessageSchema.safeParse({
          type: "session.start",
          sourceLanguage,
          mimeType: "audio/webm;codecs=opus",
        }).success,
      ).toBe(true);
    }
  });

  it("requires one to three unique target languages", () => {
    const start = {
      type: "session.start",
      sourceLanguage: "zh-HK",
      mimeType: "audio/webm;codecs=opus",
    };

    expect(clientMessageSchema.safeParse({ ...start, targetLanguages: ["zh-Hant"] }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...start, targetLanguages: ["en", "ja", "ko"] }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...start, targetLanguages: [] }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...start, targetLanguages: ["en", "ja", "ko", "id"] }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...start, targetLanguages: ["en", "en"] }).success).toBe(false);
  });

  it("accepts inactivity timeouts from 2 to 30 minutes", () => {
    for (const inactivityTimeoutMinutes of [2, 30]) {
      expect(
        clientMessageSchema.safeParse({
          type: "session.start",
          sourceLanguage: "en-AU",
          mimeType: "audio/webm;codecs=opus",
          inactivityTimeoutMinutes,
        }).success,
      ).toBe(true);
    }

    for (const inactivityTimeoutMinutes of [1, 31, 2.5]) {
      expect(
        clientMessageSchema.safeParse({
          type: "session.start",
          sourceLanguage: "en-AU",
          mimeType: "audio/webm;codecs=opus",
          inactivityTimeoutMinutes,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown controls and unsupported formats", () => {
    expect(clientMessageSchema.safeParse({ type: "session.restart" }).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "session.start",
        sourceLanguage: "en-AU",
        mimeType: "audio/mp4",
      }).success,
    ).toBe(false);
  });
});