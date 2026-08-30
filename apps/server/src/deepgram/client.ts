import WebSocket, { type RawData } from "ws";

import type { ApiTelemetry } from "../telemetry";

export interface DeepgramResult {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
  fromFinalize: boolean;
  startMs: number;
  endMs: number;
}

interface DeepgramClientOptions {
  apiKey: string;
  model: string;
  language: string;
  onResult: (result: DeepgramResult) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  telemetry: ApiTelemetry;
}

interface DeepgramResponse {
  type?: string;
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
  description?: string;
}

export class DeepgramLiveClient {
  private socket: WebSocket | undefined;
  private finalizeResolver: (() => void) | undefined;
  private connectedAt = 0;
  private firstAudioAt = 0;
  private firstResultReceived = false;

  constructor(private readonly options: DeepgramClientOptions) {}

  async connect() {
    const startedAt = performance.now();
    const params = new URLSearchParams({
      model: this.options.model,
      language: this.options.language,
      smart_format: "true",
      punctuate: "true",
      interim_results: "true",
      endpointing: "300",
      vad_events: "true",
      mip_opt_out: "true",
    });

    this.options.telemetry("api.deepgram.connect.request", {
      api: "Deepgram Live",
      method: "WSS",
      endpoint: "wss://api.deepgram.com/v1/listen",
      model: this.options.model,
      language: this.options.language,
    });

    this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.options.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deepgram connection timed out")), 10_000);

      this.socket?.once("open", () => {
        clearTimeout(timeout);
        this.connectedAt = performance.now();
        this.options.telemetry("api.deepgram.connect.response", {
          api: "Deepgram Live",
          durationMs: Math.round(this.connectedAt - startedAt),
        });
        resolve();
      });
      this.socket?.once("error", (error) => {
        clearTimeout(timeout);
        this.options.telemetry("api.deepgram.connect.error", {
          api: "Deepgram Live",
          durationMs: Math.round(performance.now() - startedAt),
          error: error.message,
        });
        reject(error);
      });
    });

    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("error", (error) => this.options.onError(error));
    this.socket.on("close", () => this.options.onClose());
  }

  sendAudio(audio: Buffer) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.firstAudioAt === 0) {
        this.firstAudioAt = performance.now();
        this.options.telemetry("api.deepgram.audio.first_chunk", {
          api: "Deepgram Live",
          bytes: audio.byteLength,
          sinceConnectedMs: Math.round(this.firstAudioAt - this.connectedAt),
        });
      }
      this.socket.send(audio, { binary: true });
    }
  }

  sendKeepAlive() {
    this.sendControl("KeepAlive");
  }

  async finalizeAndClose() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    const startedAt = performance.now();
    this.options.telemetry("api.deepgram.finalize.request", { api: "Deepgram Live" });
    const finalized = new Promise<void>((resolve) => {
      this.finalizeResolver = resolve;
    });
    this.sendControl("Finalize");

    await Promise.race([
      finalized,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);

    this.options.telemetry("api.deepgram.finalize.response", {
      api: "Deepgram Live",
      durationMs: Math.round(performance.now() - startedAt),
    });

    this.sendControl("CloseStream");
    this.socket.close();
  }

  destroy() {
    this.socket?.terminate();
  }

  private sendControl(type: "KeepAlive" | "Finalize" | "CloseStream") {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type }));
    }
  }

  private handleMessage(data: RawData) {
    try {
      const message = JSON.parse(data.toString()) as DeepgramResponse;

      if (message.type === "Error") {
        this.options.telemetry("api.deepgram.stream.error", {
          api: "Deepgram Live",
          error: message.description ?? "Unknown Deepgram error",
        });
        this.options.onError(new Error(message.description ?? "Deepgram returned an error"));
        return;
      }

      if (message.type !== "Results") return;

      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      const start = message.start ?? 0;
      const duration = message.duration ?? 0;

      if (message.from_finalize) this.finalizeResolver?.();
      if (!transcript) return;

      if (!this.firstResultReceived || message.is_final) {
        this.options.telemetry(
          this.firstResultReceived
            ? "api.deepgram.result.final"
            : "api.deepgram.result.first",
          {
            api: "Deepgram Live",
            isFinal: Boolean(message.is_final),
            speechFinal: Boolean(message.speech_final),
            sinceFirstAudioMs:
              this.firstAudioAt > 0 ? Math.round(performance.now() - this.firstAudioAt) : undefined,
            audioStartMs: Math.round(start * 1_000),
            audioEndMs: Math.round((start + duration) * 1_000),
          },
        );
        this.firstResultReceived = true;
      }

      this.options.onResult({
        transcript,
        isFinal: Boolean(message.is_final),
        speechFinal: Boolean(message.speech_final),
        fromFinalize: Boolean(message.from_finalize),
        startMs: Math.round(start * 1_000),
        endMs: Math.round((start + duration) * 1_000),
      });
    } catch (error) {
      this.options.onError(error instanceof Error ? error : new Error("Invalid Deepgram response"));
    }
  }
}