import type WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config";
import type { DeepgramResult } from "../deepgram/client";
import { LiveSession } from "./live-session";

const deepgram = vi.hoisted(() => ({
  language: "",
  onResult: undefined as ((result: DeepgramResult) => void) | undefined,
}));
const translator = vi.hoisted(() => ({ translate: vi.fn() }));

vi.mock("../deepgram/client", () => ({
  DeepgramLiveClient: class {
    constructor(options: { language: string; onResult: (result: DeepgramResult) => void }) {
      deepgram.language = options.language;
      deepgram.onResult = options.onResult;
    }

    async connect() {}
    sendAudio() {}
    sendKeepAlive() {}
    async finalizeAndClose() {}
    destroy() {}
  },
}));

vi.mock("../openai/translator", () => ({
  SermonTranslator: class {
    translate = translator.translate;
  },
}));

const result = (transcript: string): DeepgramResult => ({
  transcript,
  isFinal: false,
  speechFinal: false,
  fromFinalize: false,
  startMs: 0,
  endMs: 1_000,
});

function createSession() {
  const send = vi.fn();
  const socket = {
    OPEN: 1,
    readyState: 1,
    send,
    close: vi.fn(),
  } as unknown as WebSocket;
  const config = loadConfig({
    DEEPGRAM_API_KEY: "test-deepgram-key",
    OPENAI_API_KEY: "test-openai-key",
  });
  const session = new LiveSession(socket, config, vi.fn(), vi.fn());

  return {
    session,
    sentMessages: () => send.mock.calls.map(([message]) => JSON.parse(String(message))),
    sentTypes: () => send.mock.calls.map(([message]) => JSON.parse(String(message)).type),
  };
}

afterEach(() => {
  vi.useRealTimers();
  deepgram.language = "";
  deepgram.onResult = undefined;
  translator.translate.mockReset();
});

describe("LiveSession inactivity timeout", () => {
  it("releases a connection that never starts a session", async () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const send = vi.fn();
    const socket = {
      OPEN: 1,
      readyState: 1,
      send,
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = new LiveSession(
      socket,
      loadConfig({
        DEEPGRAM_API_KEY: "test-deepgram-key",
        OPENAI_API_KEY: "test-openai-key",
      }),
      onClosed,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(send).toHaveBeenCalledWith(expect.stringContaining("SESSION_START_TIMEOUT"));
    expect(socket.close).toHaveBeenCalledWith(1008, "Session start timed out");
    expect(onClosed).toHaveBeenCalledOnce();
    session.disconnect();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("auto-stops when empty results do not contain speech", async () => {
    vi.useFakeTimers();
    const { session, sentTypes } = createSession();

    await session.handleControl({
      type: "session.start",
      sourceLanguage: "en-AU",
      inputMode: "microphone",
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 2,
      targetLanguages: ["en", "zh-Hans", "id"],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    deepgram.onResult?.(result("   "));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sentTypes()).toContain("session.auto_stopped");
    expect(sentTypes()).toContain("session.closed");
  });

  it("restarts the timer when speech is transcribed", async () => {
    vi.useFakeTimers();
    const { session, sentTypes } = createSession();

    await session.handleControl({
      type: "session.start",
      sourceLanguage: "en-AU",
      inputMode: "microphone",
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 2,
      targetLanguages: ["en", "zh-Hans", "id"],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    deepgram.onResult?.(result("Grace and peace"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sentTypes()).not.toContain("session.auto_stopped");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentTypes()).toContain("session.auto_stopped");
  });

  it("translates only the selected target languages", async () => {
    vi.useFakeTimers();
    translator.translate.mockResolvedValue({ en: "Grace is sufficient.", ko: "은혜가 충분합니다." });
    const { session, sentMessages } = createSession();

    await session.handleControl({
      type: "session.start",
      sourceLanguage: "zh-HK",
      inputMode: "microphone",
      targetLanguages: ["en", "ko"],
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 15,
    });
    expect(deepgram.language).toBe("zh-HK");
    deepgram.onResult?.({
      transcript: "恩典係夠用嘅。",
      isFinal: true,
      speechFinal: true,
      fromFinalize: false,
      startMs: 0,
      endMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(translator.translate).toHaveBeenCalledWith("恩典係夠用嘅。", [], 1, ["en", "ko"]);
    expect(sentMessages()).toContainEqual(
      expect.objectContaining({
        type: "translation.final",
        translations: { en: "Grace is sufficient.", ko: "은혜가 충분합니다." },
      }),
    );
    session.disconnect();
  });

  it("saves only finalized source segments", async () => {
    const sourceTranscript = { configure: vi.fn(), append: vi.fn(), flush: vi.fn() };
    const send = vi.fn();
    const socket = {
      OPEN: 1,
      readyState: 1,
      send,
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = new LiveSession(
      socket,
      loadConfig({
        DEEPGRAM_API_KEY: "test-deepgram-key",
        OPENAI_API_KEY: "test-openai-key",
      }),
      vi.fn(),
      vi.fn(),
      sourceTranscript as never,
    );

    await session.handleControl({
      type: "session.start",
      sourceLanguage: "en-AU",
      inputMode: "microphone",
      targetLanguages: ["zh-Hans"],
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 15,
    });
    expect(sourceTranscript.configure).toHaveBeenCalledWith({
      inputMode: "microphone",
      sourceLanguage: "en-AU",
      targetLanguages: ["zh-Hans"],
    });
    deepgram.onResult?.(result("Temporary words"));
    expect(sourceTranscript.append).not.toHaveBeenCalled();

    deepgram.onResult?.({
      transcript: "Grace and peace.",
      isFinal: true,
      speechFinal: true,
      fromFinalize: false,
      startMs: 0,
      endMs: 1_000,
    });
    expect(sourceTranscript.append).toHaveBeenCalledOnce();
    expect(sourceTranscript.append).toHaveBeenCalledWith("Grace and peace.");
    session.disconnect();
  });

  it("translates the operator and viewer language union once and filters operator output", async () => {
    vi.useFakeTimers();
    translator.translate.mockResolvedValue({ "zh-Hans": "恩典与平安。", id: "Kasih karunia dan damai." });
    const publicPublisher = {
      start: vi.fn(),
      publish: vi.fn(),
      end: vi.fn(),
      requestedLanguages: vi.fn(() => ["zh-Hans", "id"] as Array<"zh-Hans" | "id">),
    };
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = new LiveSession(
      socket,
      loadConfig({
        DEEPGRAM_API_KEY: "test-deepgram-key",
        OPENAI_API_KEY: "test-openai-key",
      }),
      vi.fn(),
      vi.fn(),
      undefined,
      "",
      publicPublisher,
    );

    await session.handleControl({
      type: "session.start",
      sourceLanguage: "en-AU",
      inputMode: "system",
      targetLanguages: ["zh-Hans"],
      mimeType: "audio/webm;codecs=opus",
      inactivityTimeoutMinutes: 15,
    });
    expect(publicPublisher.start).toHaveBeenCalledWith(session.id, "en-AU", ["zh-Hans"]);

    deepgram.onResult?.({
      transcript: "Grace and peace.",
      isFinal: true,
      speechFinal: true,
      fromFinalize: false,
      startMs: 0,
      endMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(translator.translate).toHaveBeenCalledOnce();
    expect(translator.translate).toHaveBeenCalledWith("Grace and peace.", [], 1, ["zh-Hans", "id"]);
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"translations":{"zh-Hans":"恩典与平安。"}'));
    expect(publicPublisher.publish).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        type: "translation.final",
        translations: { "zh-Hans": "恩典与平安。", id: "Kasih karunia dan damai." },
      }),
    );

    await session.handleControl({ type: "session.stop" });
    expect(publicPublisher.end).toHaveBeenCalledWith(session.id);
  });
});
