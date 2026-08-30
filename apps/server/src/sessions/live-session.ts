import { randomUUID } from "node:crypto";

import type { ClientMessage, ServerMessage, TargetLanguage } from "@church/contracts";
import type WebSocket from "ws";

import type { AppConfig } from "../config";
import { DeepgramLiveClient, type DeepgramResult } from "../deepgram/client";
import { SermonTranslator } from "../openai/translator";
import type { ApiTelemetry } from "../telemetry";
import type { SourceTranscriptWriter } from "../transcripts/source-transcript-writer";
import { SegmentBuffer, type BufferedSegment } from "./segment-buffer";

type State = "idle" | "connecting" | "listening" | "paused" | "draining" | "closed";

export class LiveSession {
  readonly id = randomUUID();
  private state: State = "idle";
  private deepgram: DeepgramLiveClient | undefined;
  private translator: SermonTranslator | undefined;
  private readonly buffer = new SegmentBuffer();
  private readonly context: string[] = [];
  private sequence = 0;
  private queueDepth = 0;
  private translationQueue: Promise<void> = Promise.resolve();
  private lastAudioAt = Date.now();
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private limitTimer: NodeJS.Timeout | undefined;
  private inactivityTimer: NodeJS.Timeout | undefined;
  private startTimer: NodeJS.Timeout | undefined;
  private inactivityTimeoutMinutes = 15;
  private targetLanguages: TargetLanguage[] = ["en", "zh-Hans", "id"];

  constructor(
    private readonly socket: WebSocket,
    private readonly config: AppConfig,
    private readonly onClosed: () => void,
    private readonly telemetry: ApiTelemetry,
    private readonly sourceTranscript?: SourceTranscriptWriter,
  ) {
    this.startTimer = setTimeout(() => {
      if (this.state !== "idle") return;
      this.fail("SESSION_START_TIMEOUT", "The translation session did not start in time. Please try again.", true);
      this.socket.close(1008, "Session start timed out");
      this.disconnect();
    }, 10_000);
  }

  async handleControl(message: ClientMessage) {
    if (message.type === "session.start") {
      return this.start(
        message.sourceLanguage,
        message.inactivityTimeoutMinutes,
        message.targetLanguages,
      );
    }
    if (message.type === "session.pause") return this.pause();
    if (message.type === "session.resume") return this.resume();
    if (message.type === "session.stop") return this.stop();
  }

  handleAudio(audio: Buffer) {
    if (this.state !== "listening") return;
    this.lastAudioAt = Date.now();
    this.deepgram?.sendAudio(audio);
  }

  disconnect() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.clearTimers();
    this.deepgram?.destroy();
    this.onClosed();
  }

  private async start(
    language: string,
    inactivityTimeoutMinutes: number,
    targetLanguages: TargetLanguage[],
  ) {
    if (this.state !== "idle") return this.fail("INVALID_STATE", "The session has already started.", true);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
    if (!this.config.isConfigured) {
      return this.fail("SERVER_NOT_CONFIGURED", "The server is missing its Deepgram or OpenAI API key.", false);
    }

    this.state = "connecting";
    this.send({ type: "session.status", status: "connecting" });
    this.translator = new SermonTranslator(
      this.config.openAiApiKey,
      this.config.openAiModel,
      this.telemetry,
    );
    this.deepgram = new DeepgramLiveClient({
      apiKey: this.config.deepgramApiKey,
      model: this.config.deepgramModel,
      language,
      onResult: (result) => this.handleDeepgramResult(result),
      onError: () => this.fail("TRANSCRIPTION_ERROR", "The transcription connection failed. Stop and try again.", false),
      onClose: () => {
        if (this.state !== "draining" && this.state !== "closed") {
          this.fail("TRANSCRIPTION_CLOSED", "The transcription connection closed unexpectedly. Please restart.", false);
        }
      },
      telemetry: this.telemetry,
    });

    try {
      await this.deepgram.connect();
      this.state = "listening";
      this.inactivityTimeoutMinutes = inactivityTimeoutMinutes;
      this.targetLanguages = targetLanguages;
      this.lastAudioAt = Date.now();
      this.send({ type: "session.ready", sessionId: this.id });
      this.send({ type: "session.status", status: "listening" });
      this.resetInactivityTimer();
      this.keepAliveTimer = setInterval(() => {
        if (Date.now() - this.lastAudioAt >= 3_000) this.deepgram?.sendKeepAlive();
      }, 3_000);
      this.limitTimer = setTimeout(() => void this.stop(), this.config.maxSessionMinutes * 60_000);
    } catch {
      this.fail("TRANSCRIPTION_CONNECT_FAILED", "Cannot connect to the transcription service. Check the server configuration and network.", false);
      this.disconnect();
    }
  }

  private pause() {
    if (this.state !== "listening") return;
    this.state = "paused";
    this.send({ type: "session.status", status: "paused" });
  }

  private resume() {
    if (this.state !== "paused") return;
    this.state = "listening";
    this.send({ type: "session.status", status: "listening" });
  }

  private async stop() {
    if (!["listening", "paused"].includes(this.state)) return;
    this.state = "draining";
    this.send({ type: "session.status", status: "closing" });
    this.clearTimers();

    await this.deepgram?.finalizeAndClose();
    const remaining = this.buffer.flush();
    if (remaining) this.enqueueTranslation(remaining);
    await this.translationQueue;
    await this.sourceTranscript?.flush();

    this.send({ type: "session.closed" });
    this.state = "closed";
    this.socket.close(1000, "Session complete");
    this.onClosed();
  }

  private handleDeepgramResult(result: DeepgramResult) {
    if (result.transcript.trim()) this.resetInactivityTimer();
    if (!result.isFinal) {
      this.send({ type: "transcript.interim", text: result.transcript });
      return;
    }

    const segment = this.buffer.append(result);
    if (segment) this.enqueueTranslation(segment);
  }

  private enqueueTranslation(segment: BufferedSegment) {
    const sequence = ++this.sequence;
    const segmentId = randomUUID();
    const queuedAt = performance.now();
    this.sourceTranscript?.append(segment.source);
    this.send({ type: "transcript.final", segmentId, sequence, ...segment });
    this.queueDepth += 1;
    this.send({ type: "session.status", status: "translating", queueDepth: this.queueDepth });

    this.translationQueue = this.translationQueue.then(async () => {
      const translationStartedAt = performance.now();
      this.telemetry("queue.translation.started", {
        sequence,
        queueWaitMs: Math.round(translationStartedAt - queuedAt),
        queueDepth: this.queueDepth,
      });
      try {
        const translation = await this.translator?.translate(
          segment.source,
          [...this.context],
          sequence,
          this.targetLanguages,
        );
        if (!translation) throw new Error("Translator unavailable");
        this.send({
          type: "translation.final",
          segmentId,
          sequence,
          ...segment,
          translations: translation,
        });
        this.context.push(segment.source);
        while (this.context.join(" ").length > 1_200 || this.context.length > 8) this.context.shift();
      } catch {
        this.fail("TRANSLATION_FAILED", `Translation failed for segment ${sequence}. The source text was preserved.`, true);
      } finally {
        this.telemetry("queue.translation.completed", {
          sequence,
          durationMs: Math.round(performance.now() - translationStartedAt),
        });
        this.queueDepth -= 1;
        if (this.queueDepth === 0 && this.state === "listening") {
          this.send({ type: "session.status", status: "listening" });
        }
      }
    });
  }

  private clearTimers() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.limitTimer) clearTimeout(this.limitTimer);
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
  }

  private resetInactivityTimer() {
    if (!["listening", "paused"].includes(this.state)) return;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (!["listening", "paused"].includes(this.state)) return;
      this.send({
        type: "session.auto_stopped",
        inactivityTimeoutMinutes: this.inactivityTimeoutMinutes,
      });
      void this.stop();
    }, this.inactivityTimeoutMinutes * 60_000);
  }

  private fail(code: string, message: string, recoverable: boolean) {
    this.send({ type: "error", code, message, recoverable });
  }

  private send(message: ServerMessage) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }
}