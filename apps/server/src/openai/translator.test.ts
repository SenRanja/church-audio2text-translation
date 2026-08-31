import { beforeEach, describe, expect, it, vi } from "vitest";

import { SermonTranslator } from "./translator";

const responsesCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    responses = { create: responsesCreate };
  },
}));

beforeEach(() => {
  responsesCreate.mockReset();
});

describe("SermonTranslator", () => {
  it("requests and returns only the selected target languages", async () => {
    responsesCreate.mockResolvedValue({
      id: "response_test",
      output_text: JSON.stringify({
        en: "Grace is sufficient.",
        "zh-Hant": "恩典是夠用的。",
        ja: "恵みは十分です。",
      }),
    });
    const translator = new SermonTranslator("test-key", "gpt-4o-mini", vi.fn());

    await expect(
      translator.translate("恩典係夠用嘅。", [], 1, ["en", "zh-Hant", "ja"]),
    ).resolves.toEqual({
      en: "Grace is sufficient.",
      "zh-Hant": "恩典是夠用的。",
      ja: "恵みは十分です。",
    });

    const request = responsesCreate.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("OpenAI request was not captured");
    expect(request.text.format.schema).toEqual({
      type: "object",
      properties: {
        en: { type: "string" },
        "zh-Hant": { type: "string" },
        ja: { type: "string" },
      },
      required: ["en", "zh-Hant", "ja"],
      additionalProperties: false,
    });
    expect(JSON.parse(request.input).TARGET_LANGUAGES).toEqual([
      { code: "en", name: "English" },
      { code: "zh-Hant", name: "Traditional Chinese" },
      { code: "ja", name: "Japanese" },
    ]);
  });

  it("uses a user prompt instead of the default church prompt", async () => {
    responsesCreate.mockResolvedValue({
      id: "response_custom",
      output_text: JSON.stringify({ en: "A child-friendly translation." }),
    });
    const translator = new SermonTranslator(
      "test-key",
      "gpt-4o-mini",
      vi.fn(),
      "Translate in language suitable for young children.",
    );

    await translator.translate("Source", [], 1, ["en"]);

    expect(responsesCreate.mock.calls[0]?.[0].instructions).toBe(
      "Translate in language suitable for young children.",
    );
  });
});
