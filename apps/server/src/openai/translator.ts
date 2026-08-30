import OpenAI from "openai";
import { z } from "zod";
import type { TargetLanguage, TranslationMap } from "@church/contracts";

import type { ApiTelemetry } from "../telemetry";

const instructions = `You are a professional live interpreter for a Christian church sermon.
Treat the source as Christian preaching, Bible teaching, prayer, testimony, or worship. Use that context to disambiguate homophones and choose established Christian terminology, Bible book names, biblical people and places, theological terms, and Scripture references.
Remain denomination-neutral. Translate only CURRENT and use CONTEXT only to resolve pronouns, terminology, and omitted references.
Faithfully preserve the speaker's meaning, tone, names, numbers, and references. Do not summarize, explain, censor, add doctrine, correct the speaker, or invent missing words.
When a Bible quotation is recognizable, translate the words actually spoken; do not silently replace or complete them with a canonical published translation.
Translate CURRENT into every language listed in TARGET_LANGUAGES. If CURRENT is already in a target language, preserve its wording and meaning, changing only obvious recognition errors or punctuation.
Use natural language and established Christian vocabulary suitable for church audiences. For zh-Hans use Simplified Chinese; for zh-Hant use Traditional Chinese.
Use the supplied GLOSSARY consistently. If the source is incomplete or uncertain, translate conservatively without guessing.`;

const glossary = {
  grace: { en: "grace", "zh-Hans": "恩典", "zh-Hant": "恩典", ja: "恵み", ko: "은혜", id: "kasih karunia" },
  covenant: { en: "covenant", "zh-Hans": "约", "zh-Hant": "約", ja: "契約", ko: "언약", id: "perjanjian" },
  "Holy Spirit": { en: "Holy Spirit", "zh-Hans": "圣灵", "zh-Hant": "聖靈", ja: "聖霊", ko: "성령", id: "Roh Kudus" },
  gospel: { en: "gospel", "zh-Hans": "福音", "zh-Hant": "福音", ja: "福音", ko: "복음", id: "Injil" },
  salvation: { en: "salvation", "zh-Hans": "救恩", "zh-Hant": "救恩", ja: "救い", ko: "구원", id: "keselamatan" },
  resurrection: { en: "resurrection", "zh-Hans": "复活", "zh-Hant": "復活", ja: "復活", ko: "부활", id: "kebangkitan" },
  righteousness: { en: "righteousness", "zh-Hans": "公义", "zh-Hant": "公義", ja: "義", ko: "의", id: "kebenaran" },
  repentance: { en: "repentance", "zh-Hans": "悔改", "zh-Hant": "悔改", ja: "悔い改め", ko: "회개", id: "pertobatan" },
  discipleship: { en: "discipleship", "zh-Hans": "门徒训练", "zh-Hant": "門徒訓練", ja: "弟子訓練", ko: "제자훈련", id: "pemuridan" },
  Scripture: { en: "Scripture", "zh-Hans": "圣经", "zh-Hant": "聖經", ja: "聖書", ko: "성경", id: "Kitab Suci" },
};

const targetLanguageNames: Record<TargetLanguage, string> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  id: "Bahasa Indonesia",
};

export class SermonTranslator {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly telemetry: ApiTelemetry,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async translate(
    current: string,
    context: string[],
    sequence: number,
    targetLanguages: TargetLanguage[],
  ): Promise<TranslationMap> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now();
      try {
        this.telemetry("api.openai.responses.request", {
          api: "OpenAI Responses",
          method: "POST",
          endpoint: "https://api.openai.com/v1/responses",
          model: this.model,
          sequence,
          attempt: attempt + 1,
          targetLanguages: targetLanguages.join(","),
          sourceChars: current.length,
          contextSegments: context.length,
          contextChars: context.join(" ").length,
        });
        const response = await this.client.responses.create({
          model: this.model,
          store: false,
          instructions,
          input: JSON.stringify({
            CONTEXT: context,
            CURRENT: current,
            TARGET_LANGUAGES: targetLanguages.map((code) => ({
              code,
              name: targetLanguageNames[code],
            })),
            GLOSSARY: glossary,
          }),
          text: {
            format: {
              type: "json_schema",
              name: "sermon_translation",
              strict: true,
              schema: {
                type: "object",
                properties: Object.fromEntries(
                  targetLanguages.map((language) => [language, { type: "string" }]),
                ),
                required: targetLanguages,
                additionalProperties: false,
              },
            },
          },
        });

        this.telemetry("api.openai.responses.response", {
          api: "OpenAI Responses",
          sequence,
          attempt: attempt + 1,
          durationMs: Math.round(performance.now() - startedAt),
          responseId: response.id,
        });

        return parseTranslation(response.output_text, targetLanguages);
      } catch (error) {
        lastError = error;
        this.telemetry("api.openai.responses.error", {
          api: "OpenAI Responses",
          sequence,
          attempt: attempt + 1,
          durationMs: Math.round(performance.now() - startedAt),
          status: getErrorStatus(error),
          error: error instanceof Error ? error.message : "Unknown OpenAI error",
        });
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Translation failed");
  }
}

function parseTranslation(output: string, targetLanguages: TargetLanguage[]) {
  const parsed = z.record(z.string(), z.string().min(1)).parse(JSON.parse(output));
  const translations: TranslationMap = {};

  for (const language of targetLanguages) {
    const value = parsed[language];
    if (!value) throw new Error(`Translation is missing ${language}`);
    translations[language] = value;
  }

  if (Object.keys(parsed).some((language) => !targetLanguages.includes(language as TargetLanguage))) {
    throw new Error("Translation contains an unexpected language");
  }

  return translations;
}

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}