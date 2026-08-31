import { z } from "zod";

export const sourceLanguageSchema = z.enum([
  "en-AU",
  "en-US",
  "en-GB",
  "zh-HK",
  "zh-CN",
  "ja",
  "ko-KR",
  "id",
]);

export const targetLanguageSchema = z.enum(["en", "zh-Hans", "zh-Hant", "ja", "ko", "id"]);
export const viewerLanguagesSchema = z
  .tuple([targetLanguageSchema, targetLanguageSchema])
  .refine(([first, second]) => first !== second, {
    message: "Viewer languages must be unique",
  });
export const inputModeSchema = z.enum(["microphone", "system"]);
export const targetLanguagesSchema = z
  .array(targetLanguageSchema)
  .min(1)
  .max(3)
  .refine((languages) => new Set(languages).size === languages.length, {
    message: "Target languages must be unique",
  })
  .default(["en", "zh-Hans", "id"]);

export type SourceLanguage = z.infer<typeof sourceLanguageSchema>;
export type TargetLanguage = z.infer<typeof targetLanguageSchema>;
export type ViewerLanguages = z.infer<typeof viewerLanguagesSchema>;
export type TranslationMap = Partial<Record<TargetLanguage, string>>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.start"),
    sourceLanguage: sourceLanguageSchema,
    inputMode: inputModeSchema.default("microphone"),
    mimeType: z.literal("audio/webm;codecs=opus"),
    inactivityTimeoutMinutes: z.number().int().min(2).max(30).default(15),
    targetLanguages: targetLanguagesSchema,
  }),
  z.object({ type: z.literal("session.pause") }),
  z.object({ type: z.literal("session.resume") }),
  z.object({ type: z.literal("session.stop") }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type SessionStatus =
  | "connecting"
  | "listening"
  | "paused"
  | "translating"
  | "closing";

export type ServerMessage =
  | { type: "session.ready"; sessionId: string }
  | { type: "session.auto_stopped"; inactivityTimeoutMinutes: number }
  | { type: "session.status"; status: SessionStatus; queueDepth?: number }
  | { type: "transcript.interim"; text: string }
  | {
      type: "transcript.final";
      segmentId: string;
      sequence: number;
      source: string;
      startMs: number;
      endMs: number;
    }
  | {
      type: "translation.final";
      segmentId: string;
      sequence: number;
      source: string;
      translations: TranslationMap;
      startMs: number;
      endMs: number;
    }
  | { type: "session.closed" }
  | {
      type: "error";
      code: string;
      message: string;
      recoverable: boolean;
    };

export interface TranslationSegment {
  segmentId: string;
  sequence: number;
  source: string;
  translations: TranslationMap;
  startMs: number;
  endMs: number;
  state: "transcribing" | "translating" | "complete" | "failed";
}

export interface PublicLiveSnapshot {
  username: string;
  sessionId: string | null;
  sourceLanguage: SourceLanguage | null;
  targetLanguages: TargetLanguage[];
  status: SessionStatus | "offline";
  queueDepth: number;
  interim: string;
  segments: TranslationSegment[];
}

export type PublicLiveEvent =
  | { type: "snapshot"; snapshot: PublicLiveSnapshot }
  | { type: "status"; status: SessionStatus; queueDepth: number }
  | { type: "interim"; text: string }
  | { type: "segment"; segment: TranslationSegment }
  | { type: "offline" };