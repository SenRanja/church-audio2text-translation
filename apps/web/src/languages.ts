import type { SourceLanguage, TargetLanguage } from '@church/contracts'

export const sourceLanguageOptions: ReadonlyArray<{
  value: SourceLanguage
  label: string
}> = [
  { value: 'en-AU', label: 'English · Australia' },
  { value: 'en-US', label: 'English · United States' },
  { value: 'en-GB', label: 'English · United Kingdom' },
  { value: 'zh-HK', label: '粤语 · Cantonese' },
  { value: 'zh-CN', label: '普通话 · Mandarin' },
  { value: 'ja', label: '日本語 · Japanese' },
  { value: 'ko-KR', label: '한국어 · Korean' },
  { value: 'id', label: 'Bahasa Indonesia' },
]

export const targetLanguageOptions: ReadonlyArray<{
  value: TargetLanguage
  label: string
  subtitle: string
  htmlLanguage: string
}> = [
  { value: 'en', label: 'English', subtitle: 'English translation', htmlLanguage: 'en' },
  { value: 'zh-Hans', label: '简体中文', subtitle: 'Chinese · Simplified', htmlLanguage: 'zh-CN' },
  { value: 'zh-Hant', label: '繁體中文', subtitle: 'Chinese · Traditional', htmlLanguage: 'zh-Hant' },
  { value: 'ja', label: '日本語', subtitle: 'Japanese', htmlLanguage: 'ja' },
  { value: 'ko', label: '한국어', subtitle: 'Korean', htmlLanguage: 'ko' },
  { value: 'id', label: 'Bahasa Indonesia', subtitle: 'Indonesian', htmlLanguage: 'id' },
]

export function getSourceLanguageOption(language: SourceLanguage) {
  return sourceLanguageOptions.find((option) => option.value === language) ?? sourceLanguageOptions[0]
}

export function getTargetLanguageOption(language: TargetLanguage) {
  return targetLanguageOptions.find((option) => option.value === language) ?? targetLanguageOptions[0]
}
