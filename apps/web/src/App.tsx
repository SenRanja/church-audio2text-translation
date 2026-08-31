import {
  Check,
  Church,
  Copy,
  Download,
  Expand,
  Mic,
  MonitorSpeaker,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Square,
  Trash2,
  Waves,
  X,
} from 'lucide-react'
import type { SourceLanguage, TargetLanguage } from '@church/contracts'
import { useEffect, useRef, useState } from 'react'

import './App.css'
import { AccountMenu } from './AccountMenu'
import type { CurrentUser } from './AuthApp'
import {
  getSourceLanguageOption,
  getTargetLanguageOption,
  sourceLanguageOptions,
  targetLanguageOptions,
} from './languages'
import { type SessionPhase, useLiveTranslation } from './useLiveTranslation'
import { useCaptionWindow } from './useCaptionWindow'
import { getPublicBroadcastUrl } from './public-route'

const phaseLabels: Record<SessionPhase, string> = {
  idle: 'Ready',
  requesting: 'Microphone permission',
  connecting: 'Connecting',
  listening: 'Live',
  paused: 'Paused',
  translating: 'Translating',
  stopping: 'Finishing',
  error: 'Needs attention',
}

type TextArea = TargetLanguage | 'liveSource'
const minimumFontSize = 14
const maximumFontSize = 32

function App({ user, onLogout }: { user: CurrentUser; onLogout: () => Promise<void> }) {
  const session = useLiveTranslation()
  const [activeLanguage, setActiveLanguage] = useState<TargetLanguage>('zh-Hans')
  const [autoScroll, setAutoScroll] = useState(true)
  const [captionNotice, setCaptionNotice] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [fontSizes, setFontSizes] = useState<Record<TextArea, number>>({
    en: 18,
    'zh-Hans': 18,
    'zh-Hant': 18,
    ja: 18,
    ko: 18,
    id: 18,
    liveSource: 18,
  })
  const paneEndRefs = useRef<Partial<Record<TargetLanguage, HTMLDivElement | null>>>({})
  const latestSegment = session.segments.at(-1)
  const latestTranslation = session.segments.findLast(
    (segment) => segment.state === 'complete',
  )
  const caption = useCaptionWindow({
    sourceLabel: getSourceLanguageOption(session.sourceLanguage).label,
    liveSource: session.interim || latestSegment?.source || '',
    translations: session.targetLanguages.map((language) => ({
      label: getTargetLanguageOption(language).label,
      value: latestTranslation?.translations[language] || '',
    })),
  })
  const captionToggleRef = useRef<() => void>(() => undefined)
  const copyResetTimerRef = useRef<number>(undefined)

  const toggleCaption = async () => {
    const succeeded = await caption.toggle()
    setCaptionNotice(
      succeeded ? '' : 'Floating captions could not open. Use the latest Microsoft Edge or Chrome.',
    )
  }
  captionToggleRef.current = () => void toggleCaption()

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        captionToggleRef.current()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => () => {
    if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current)
  }, [])

  useEffect(() => {
    if (!autoScroll) return
    const visibleLanguages = window.matchMedia('(max-width: 760px)').matches
      ? [activeLanguage]
      : session.targetLanguages

    visibleLanguages.forEach((language) => {
      const target = paneEndRefs.current[language]
      const scrollContainer = target?.parentElement
      scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' })
    })
  }, [session.segments, session.interim, session.targetLanguages, activeLanguage, autoScroll])

  const isActive = !['idle', 'error'].includes(session.phase)
  const publicBroadcastUrl = getPublicBroadcastUrl(window.location.origin, user.username)

  const copyBroadcastLink = async () => {
    try {
      await copyText(publicBroadcastUrl)
      setLinkCopied(true)
      if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => setLinkCopied(false), 2_000)
    } catch {
      setCaptionNotice('The public link could not be copied.')
    }
  }

  const adjustFontSize = (area: TextArea, change: number) => {
    setFontSizes((current) => ({
      ...current,
      [area]: Math.min(maximumFontSize, Math.max(minimumFontSize, current[area] + change)),
    }))
  }

  const changeTargetLanguage = (index: number, language: TargetLanguage) => {
    if (session.targetLanguages.includes(language)) return
    if (activeLanguage === session.targetLanguages[index]) setActiveLanguage(language)
    session.setTargetLanguages((current) =>
      current.map((currentLanguage, currentIndex) =>
        currentIndex === index ? language : currentLanguage,
      ),
    )
  }

  const addTargetLanguage = () => {
    const nextLanguage = targetLanguageOptions.find(
      (option) => !session.targetLanguages.includes(option.value),
    )?.value
    if (!nextLanguage || session.targetLanguages.length >= 3) return
    session.setTargetLanguages((current) => [...current, nextLanguage])
  }

  const removeTargetLanguage = (language: TargetLanguage) => {
    if (session.targetLanguages.length <= 1) return
    const nextLanguages = session.targetLanguages.filter((item) => item !== language)
    if (activeLanguage === language) setActiveLanguage(nextLanguages[0])
    session.setTargetLanguages(nextLanguages)
  }

  const download = () => {
    const lines = session.segments.flatMap((segment) => {
      const translations = session.targetLanguages.map(
        (language) =>
          `${getTargetLanguageOption(language).label}: ${segment.translations[language] ?? '—'}`,
      )
      return [`[${formatTime(segment.startMs)}] Source: ${segment.source}`, ...translations, '']
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `sermon-translation-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Church size={22} strokeWidth={1.8} /></span>
          <span>
            <strong>Living Word</strong>
            <small>Live sermon translation</small>
          </span>
        </div>
        <div className={`status status-${session.phase}`} role="status">
          <span className="status-dot" />
          {phaseLabels[session.phase]}
          {session.queueDepth > 0 && <span className="queue-count">{session.queueDepth}</span>}
        </div>
        <div className="topbar-actions">
          <AccountMenu user={user} onLogout={onLogout} />
          <button
            className="icon-button"
            type="button"
            aria-label="Enter fullscreen"
            title="Fullscreen"
            onClick={() => void document.documentElement.requestFullscreen()}
          >
            <Expand size={19} />
          </button>
        </div>
      </header>

      <main>
        <section className="control-deck" aria-label="Live translation controls">
          <div className="deck-heading">
            <div>
              <span className="eyebrow">Sunday service</span>
              <h1>Speak clearly. Share faithfully.</h1>
            </div>
            <div className="signal" aria-label={`Microphone level ${Math.round(session.volume * 100)} percent`}>
              <Waves size={18} />
              <div className="meter" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <span key={index} className={session.volume * 10 > index ? 'meter-active' : ''} />
                ))}
              </div>
            </div>
          </div>

          <div className="controls-row">
            <div className="field input-mode-field">
              <span>Audio input</span>
              <div className="segmented-control" role="group" aria-label="Audio input">
                <button
                  type="button"
                  className={session.inputMode === 'microphone' ? 'selected' : ''}
                  disabled={isActive}
                  aria-pressed={session.inputMode === 'microphone'}
                  onClick={() => session.setInputMode('microphone')}
                >
                  <Mic size={15} /> Microphone
                </button>
                <button
                  type="button"
                  className={session.inputMode === 'system' ? 'selected' : ''}
                  disabled={isActive}
                  aria-pressed={session.inputMode === 'system'}
                  onClick={() => session.setInputMode('system')}
                >
                  <MonitorSpeaker size={15} /> System audio
                </button>
              </div>
            </div>

            <label className="field microphone-field">
              <span>{session.inputMode === 'microphone' ? 'Microphone' : 'Windows capture'}</span>
              {session.inputMode === 'microphone' ? (
                <select
                  value={session.selectedDeviceId}
                  disabled={isActive}
                  onChange={(event) => session.setSelectedDeviceId(event.target.value)}
                >
                  {session.devices.length === 0 && <option value="">Default microphone</option>}
                  {session.devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="capture-hint">Choose Entire screen + Share system audio</div>
              )}
            </label>

            <label className="field language-field">
              <span>Speaker language</span>
              <select
                value={session.sourceLanguage}
                disabled={isActive}
                onChange={(event) =>
                  session.setSourceLanguage(event.target.value as SourceLanguage)
                }
              >
                {sourceLanguageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="field inactivity-field">
              <span>Auto-stop · no speech</span>
              <div className="inactivity-control">
                <input
                  type="range"
                  min="2"
                  max="30"
                  step="1"
                  value={session.inactivityTimeoutMinutes}
                  disabled={isActive}
                  aria-label="Minutes without speech before stopping"
                  onChange={(event) =>
                    session.setInactivityTimeoutMinutes(Number(event.target.value))
                  }
                />
                <output>{session.inactivityTimeoutMinutes} min</output>
              </div>
            </label>

            <div className="session-actions">
              {!isActive ? (
                <button className="primary-button" type="button" onClick={() => void session.start()}>
                  <Mic size={18} /> Start translating
                </button>
              ) : (
                <>
                  <button
                    className="icon-button action-button"
                    type="button"
                    onClick={session.phase === 'paused' ? session.resume : session.pause}
                    disabled={session.phase === 'connecting' || session.phase === 'stopping'}
                    aria-label={session.phase === 'paused' ? 'Resume' : 'Pause'}
                    title={session.phase === 'paused' ? 'Resume' : 'Pause'}
                  >
                    {session.phase === 'paused' ? <Play size={20} /> : <Pause size={20} />}
                  </button>
                  <button
                    className="icon-button action-button stop-button"
                    type="button"
                    onClick={session.stop}
                    disabled={session.phase === 'stopping'}
                    aria-label="Stop session"
                    title="Stop"
                  >
                    <Square size={18} fill="currentColor" />
                  </button>
                </>
              )}
            </div>
          </div>
          {session.error && <div className="error-banner" role="alert">{session.error}</div>}
          {session.notice && <div className="notice-banner" role="status">{session.notice}</div>}
        </section>

        <section className="translation-workspace">
          <div className="workspace-toolbar">
            <div className="language-tabs" role="tablist" aria-label="Translation language">
              {session.targetLanguages.map((language) => (
                <button
                  key={language}
                  type="button"
                  role="tab"
                  aria-selected={activeLanguage === language}
                  onClick={() => setActiveLanguage(language)}
                >
                  {getTargetLanguageOption(language).label}
                </button>
              ))}
            </div>
            <div className="utility-actions">
              <button
                className="icon-button toolbar-control add-pane-button"
                type="button"
                onClick={addTargetLanguage}
                disabled={isActive || session.targetLanguages.length >= 3}
                aria-label="Add translation panel"
                title="Add translation panel"
              >
                <Plus size={18} />
              </button>
              <button
                className="icon-button toolbar-control broadcast-link-button"
                type="button"
                onClick={() => void copyBroadcastLink()}
                aria-label="Copy public broadcast link"
                title={publicBroadcastUrl}
              >
                {linkCopied ? <Check size={17} /> : <Copy size={17} />}
                <span>{linkCopied ? 'Copied' : 'Copy link'}</span>
              </button>
              <label className="toggle toolbar-control">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(event) => setAutoScroll(event.target.checked)}
                />
                <span aria-hidden="true"><Check size={12} /></span>
                Auto-scroll
              </label>
              <button
                className={`icon-button toolbar-control floating-button ${caption.isOpen ? 'utility-active' : ''}`}
                type="button"
                onClick={() => void toggleCaption()}
                aria-label={caption.isOpen ? 'Close floating captions' : 'Open floating captions'}
                aria-keyshortcuts="Alt+F"
                title={caption.isSupported ? 'Floating captions (Alt+F)' : 'Not supported by this browser'}
              >
                <PictureInPicture2 size={20} />
                <span>{caption.isOpen ? 'Close floating' : 'Floating'}</span>
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={session.clear}
                disabled={session.segments.length === 0}
                aria-label="Clear translations"
                title="Clear"
              >
                <Trash2 size={18} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={download}
                disabled={session.segments.length === 0}
                aria-label="Download transcript"
                title="Download"
              >
                <Download size={18} />
              </button>
            </div>
          </div>

          {captionNotice && <div className="caption-notice" role="status">{captionNotice}</div>}

          <div
            className="translation-grid"
            style={{
              gridTemplateColumns: `repeat(${session.targetLanguages.length}, minmax(0, 1fr))`,
            }}
          >
            {session.targetLanguages.map((language, index) => (
              <TranslationPane
                key={language}
                index={index}
                language={language}
                selectedLanguages={session.targetLanguages}
                active={activeLanguage === language}
                disabled={isActive}
                removable={session.targetLanguages.length > 1}
                segments={session.segments}
                endRef={(element) => {
                  paneEndRefs.current[language] = element
                }}
                fontSize={fontSizes[language]}
                onLanguageChange={(nextLanguage) => changeTargetLanguage(index, nextLanguage)}
                onRemove={() => removeTargetLanguage(language)}
                onFontSizeChange={(change) => adjustFontSize(language, change)}
              />
            ))}
          </div>

          <div className={`live-source ${session.interim ? 'source-active' : ''}`} aria-live="polite">
            <div className="live-source-heading">
              <span><Mic size={14} /> {getSourceLanguageOption(session.sourceLanguage).label} source</span>
              <FontSizeControls
                value={fontSizes.liveSource}
                label="Live source"
                onChange={(change) => adjustFontSize('liveSource', change)}
              />
            </div>
            <p style={{ fontSize: fontSizes.liveSource }}>
              {session.interim || latestSource(session.segments) || 'Awaiting speech'}
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

interface TranslationPaneProps {
  index: number
  language: TargetLanguage
  selectedLanguages: TargetLanguage[]
  active: boolean
  disabled: boolean
  removable: boolean
  segments: ReturnType<typeof useLiveTranslation>['segments']
  endRef: (element: HTMLDivElement | null) => void
  fontSize: number
  onLanguageChange: (language: TargetLanguage) => void
  onRemove: () => void
  onFontSizeChange: (change: number) => void
}

function TranslationPane({
  index,
  language,
  selectedLanguages,
  active,
  disabled,
  removable,
  segments,
  endRef,
  fontSize,
  onLanguageChange,
  onRemove,
  onFontSizeChange,
}: TranslationPaneProps) {
  const details = getTargetLanguageOption(language)

  return (
    <article className={`translation-pane ${active ? 'pane-active' : ''}`} lang={details.htmlLanguage}>
      <header>
        <div className="pane-language-picker">
          <select
            value={language}
            disabled={disabled}
            aria-label={`Language for translation panel ${index + 1}`}
            onChange={(event) => onLanguageChange(event.target.value as TargetLanguage)}
          >
            {targetLanguageOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value !== language && selectedLanguages.includes(option.value)}
              >
                {option.label}
              </option>
            ))}
          </select>
          <span>{details.subtitle}</span>
        </div>
        <div className="pane-header-tools">
          <span className="segment-total">{segments.length.toString().padStart(2, '0')}</span>
          <FontSizeControls value={fontSize} label={details.label} onChange={onFontSizeChange} />
          {removable && (
            <button
              className="pane-close-button"
              type="button"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove ${details.label} translation panel`}
              title="Remove panel"
            >
              <X size={17} />
            </button>
          )}
        </div>
      </header>
      <div className="segment-list">
        {segments.length === 0 ? (
          <div className="empty-state">
            <Waves size={30} strokeWidth={1.4} />
            <p>Awaiting speech</p>
          </div>
        ) : (
          segments.map((segment) => {
            const translation = segment.translations[language]
            return (
              <div className="translation-segment" key={segment.segmentId}>
                <span className="segment-time">{formatTime(segment.startMs)}</span>
                {translation ? (
                  <p style={{ fontSize }}>{translation}</p>
                ) : segment.state === 'complete' || segment.state === 'failed' ? (
                  <p className="translation-unavailable" style={{ fontSize }}>—</p>
                ) : (
                  <div className="translating-line" aria-label="Translating">
                    <span /><span /><span />
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>
    </article>
  )
}

function FontSizeControls({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (change: number) => void
}) {
  return (
    <div className="font-size-controls" aria-label={`${label} font size`}>
      <button
        type="button"
        onClick={() => onChange(-2)}
        disabled={value <= minimumFontSize}
        aria-label={`Decrease ${label} font size`}
        title="Decrease font size"
      >
        A-
      </button>
      <button
        type="button"
        onClick={() => onChange(2)}
        disabled={value >= maximumFontSize}
        aria-label={`Increase ${label} font size`}
        title="Increase font size"
      >
        A+
      </button>
    </div>
  )
}

function latestSource(segments: ReturnType<typeof useLiveTranslation>['segments']) {
  return segments.at(-1)?.source
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Copy failed')
}

export default App