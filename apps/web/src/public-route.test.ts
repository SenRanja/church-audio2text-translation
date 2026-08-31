import { describe, expect, it } from 'vitest'

import { getPublicBroadcastUrl, getPublicUsername } from './public-route'

describe('getPublicUsername', () => {
  it('routes a valid username and preserves URL encoding', () => {
    expect(getPublicUsername('/FOCUS-Kevin')).toBe('FOCUS-Kevin')
    expect(getPublicUsername('/Church%40Sydney')).toBe('Church@Sydney')
  })

  it('keeps application and nested paths out of the public viewer', () => {
    expect(getPublicUsername('/')).toBeNull()
    expect(getPublicUsername('/api')).toBeNull()
    expect(getPublicUsername('/health')).toBeNull()
    expect(getPublicUsername('/FOCUS-Kevin/settings')).toBeNull()
    expect(getPublicUsername('/bad%2Fname')).toBeNull()
  })

  it('creates a permanent public URL from the current origin and username', () => {
    expect(getPublicBroadcastUrl('https://shenyanjian.top', 'FOCUS-Kevin')).toBe(
      'https://shenyanjian.top/FOCUS-Kevin',
    )
    expect(getPublicBroadcastUrl('https://shenyanjian.top', 'Church@Sydney')).toBe(
      'https://shenyanjian.top/Church%40Sydney',
    )
  })
})