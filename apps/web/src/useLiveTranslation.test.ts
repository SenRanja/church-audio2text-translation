import type { TranslationSegment } from '@church/contracts'
import { describe, expect, it } from 'vitest'

import { getMediaAccessError, upsertTranslationSegment } from './useLiveTranslation'

const segment = (segmentId: string, sequence: number, source: string): TranslationSegment => ({
  segmentId,
  sequence,
  source,
  translations: {},
  startMs: 0,
  endMs: 1_000,
  state: 'translating',
})

describe('translation segment ordering', () => {
  it('keeps arrival order when restarted sessions reuse sequence numbers', () => {
    const first = segment('first-session', 1, 'First')
    const second = segment('second-session', 1, 'Second')
    const third = segment('third-session', 1, 'Third')

    const received = [first, second, third].reduce(upsertTranslationSegment, [])
    const completedSecond = {
      ...second,
      translations: { en: 'Second translation' },
      state: 'complete' as const,
    }
    const updated = upsertTranslationSegment(received, completedSecond)

    expect(updated.map(({ segmentId }) => segmentId)).toEqual([
      'first-session',
      'second-session',
      'third-session',
    ])
    expect(updated[1]).toEqual(completedSecond)
  })
})

describe('media access support', () => {
  it('explains that LAN HTTP pages require HTTPS instead of throwing a TypeError', () => {
    expect(getMediaAccessError(false, false)).toBe(
      'Microphone access requires HTTPS. Only this computer can use http://localhost.',
    )
  })

  it('distinguishes an unsupported browser from an insecure page', () => {
    expect(getMediaAccessError(true, false)).toBe(
      'This browser does not support microphone access. Use the latest Chrome or Edge.',
    )
    expect(getMediaAccessError(true, true)).toBe('')
  })
})