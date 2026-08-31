import { Church, Radio, Waves } from 'lucide-react'
import type { PublicLiveEvent, PublicLiveSnapshot, TargetLanguage, ViewerLanguages } from '@church/contracts'
import { useEffect, useRef, useState } from 'react'

import './PublicCaptionPage.css'
import { getSourceLanguageOption, getTargetLanguageOption, targetLanguageOptions } from './languages'

const offlineSnapshot = (username: string): PublicLiveSnapshot => ({
  username,
  sessionId: null,
  sourceLanguage: null,
  targetLanguages: [],
  status: 'offline',
  queueDepth: 0,
  interim: '',
  segments: [],
})

export function PublicCaptionPage({ username }: { username: string }) {
  const [snapshot, setSnapshot] = useState(() => offlineSnapshot(username))
  const [connected, setConnected] = useState(false)
  const [selectedLanguages, setSelectedLanguages] = useState<ViewerLanguages>(() => loadViewerLanguages(username))
  const endRefs = useRef<Partial<Record<TargetLanguage, HTMLDivElement | null>>>({})

  useEffect(() => {
    document.title = `${username} · Live Translation`
    setConnected(false)
    const query = new URLSearchParams({ languages: selectedLanguages.join(',') })
    const events = new EventSource(`/api/public/live/${encodeURIComponent(username)}?${query}`)
    events.onopen = () => setConnected(true)
    events.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as PublicLiveEvent
        setSnapshot((current) => applyPublicEvent(current, incoming, username))
      } catch {
        setConnected(false)
      }
    }
    events.onerror = () => setConnected(false)
    return () => events.close()
  }, [username, selectedLanguages])

  useEffect(() => {
    localStorage.setItem(`public-caption-languages:${username.toLocaleLowerCase()}`, JSON.stringify(selectedLanguages))
  }, [selectedLanguages, username])

  useEffect(() => {
    let cancelled = false
    const scrollToLatest = () => {
      if (cancelled) return
      selectedLanguages.forEach((language) => {
        const scrollContainer = endRefs.current[language]?.parentElement
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
      })
    }
    scrollToLatest()
    const frame = requestAnimationFrame(scrollToLatest)
    void document.fonts.ready.then(scrollToLatest)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [selectedLanguages, snapshot])

  const selectLanguage = (pane: 0 | 1, language: TargetLanguage) => {
    setSelectedLanguages((current) => pane === 0 ? [language, current[1]] : [current[0], language])
  }

  const live = snapshot.sessionId !== null
  const source = snapshot.interim || snapshot.segments.at(-1)?.source || 'Awaiting speech'

  return (
    <div className="public-caption-page">
      <header className="public-header">
        <div className="public-brand">
          <span><Church size={21} strokeWidth={1.8} /></span>
          <div><strong>Living Word</strong><small>{username}</small></div>
        </div>
        <div className={`public-status ${live ? 'is-live' : ''}`} role="status">
          <i /> {live ? statusLabel(snapshot.status) : connected ? 'Waiting for stream' : 'Connecting'}
        </div>
      </header>

      <main className="public-caption-main">
        <section
          className="public-translation-grid"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
        >
          {selectedLanguages.map((language, pane) => {
            const details = getTargetLanguageOption(language)
            return (
              <article className="public-translation-pane" key={language} lang={details.htmlLanguage}>
                <header>
                  <div>
                    <select
                      aria-label={`Caption language ${pane + 1}`}
                      value={language}
                      onChange={(event) => selectLanguage(pane as 0 | 1, event.target.value as TargetLanguage)}
                    >
                      {targetLanguageOptions.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={selectedLanguages[1 - pane] === option.value}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>{details.subtitle}</small>
                  </div>
                  <span>{snapshot.segments.length.toString().padStart(2, '0')}</span>
                </header>
                <div className="public-segment-list">
                  {!live ? (
                    <div className="public-awaiting"><Radio size={30} strokeWidth={1.4} /> Waiting for stream</div>
                  ) : snapshot.segments.length === 0 ? (
                    <div className="public-awaiting"><Waves size={30} strokeWidth={1.4} /> Awaiting speech</div>
                  ) : snapshot.segments.map((segment) => (
                    <div className="public-segment" key={segment.segmentId}>
                      <time>{formatTime(segment.startMs)}</time>
                      {segment.translations[language] ? (
                        <p>{segment.translations[language]}</p>
                      ) : segment.state === 'complete' ? (
                        <p className="public-not-available">Available from next caption</p>
                      ) : (
                        <div className="public-translating" aria-label="Translating"><i /><i /><i /></div>
                      )}
                    </div>
                  ))}
                  <div ref={(element) => { endRefs.current[language] = element }} />
                </div>
              </article>
            )
          })}
        </section>

        {live && (
          <section className={`public-source ${snapshot.interim ? 'is-speaking' : ''}`} aria-live="polite">
              <div>
                <span>Source</span>
                <strong>{snapshot.sourceLanguage ? getSourceLanguageOption(snapshot.sourceLanguage).label : ''}</strong>
              </div>
              <p>{source}</p>
          </section>
        )}
      </main>
    </div>
  )
}

function loadViewerLanguages(username: string): ViewerLanguages {
  try {
    const stored = JSON.parse(localStorage.getItem(`public-caption-languages:${username.toLocaleLowerCase()}`) ?? '') as unknown
    if (
      Array.isArray(stored) && stored.length === 2 && stored[0] !== stored[1] &&
      stored.every((language) => targetLanguageOptions.some((option) => option.value === language))
    ) {
      return stored as ViewerLanguages
    }
  } catch {
  }
  return ['en', 'zh-Hans']
}

export function applyPublicEvent(
  current: PublicLiveSnapshot,
  event: PublicLiveEvent,
  username: string,
) {
  if (event.type === 'snapshot') return event.snapshot
  if (event.type === 'offline') return offlineSnapshot(username)
  if (event.type === 'status') {
    return { ...current, status: event.status, queueDepth: event.queueDepth }
  }
  if (event.type === 'interim') return { ...current, interim: event.text }

  const index = current.segments.findIndex((segment) => segment.segmentId === event.segment.segmentId)
  const segments = [...current.segments]
  if (index === -1) segments.push(event.segment)
  else segments[index] = event.segment
  return { ...current, interim: '', segments }
}

function statusLabel(status: PublicLiveSnapshot['status']) {
  if (status === 'paused') return 'Paused'
  if (status === 'closing') return 'Finishing'
  if (status === 'connecting') return 'Connecting'
  return 'Live'
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}