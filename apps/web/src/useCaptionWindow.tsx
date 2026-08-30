import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

interface CaptionContent {
  sourceLabel: string
  liveSource: string
  translations: Array<{ label: string; value: string }>
}

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export function useCaptionWindow(content: CaptionContent) {
  const [isOpen, setIsOpen] = useState(false)
  const captionWindowRef = useRef<Window>(null)
  const captionRootRef = useRef<Root>(null)
  const isOpeningRef = useRef(false)
  const isSupported = Boolean(window.documentPictureInPicture)
  const { sourceLabel, liveSource, translations } = content
  const translationsKey = JSON.stringify(translations)

  useEffect(() => {
    const captionWindow = captionWindowRef.current
    if (!captionWindow || captionWindow.closed) return
    const currentTranslations = JSON.parse(translationsKey) as CaptionContent['translations']
    captionRootRef.current?.render(
      <CaptionWindow
        content={{ sourceLabel, liveSource, translations: currentTranslations }}
      />,
    )
  }, [sourceLabel, liveSource, translationsKey])

  useEffect(
    () => () => {
      captionRootRef.current?.unmount()
      captionWindowRef.current?.close()
    },
    [],
  )

  const open = async () => {
    if (!window.documentPictureInPicture) return false
    if (captionWindowRef.current && !captionWindowRef.current.closed) {
      captionWindowRef.current.focus()
      return true
    }
    if (isOpeningRef.current) return true

    let captionWindow: Window
    isOpeningRef.current = true
    try {
      captionWindow = await window.documentPictureInPicture.requestWindow({
        width: 960,
        height: 440,
      })
    } catch {
      return false
    } finally {
      isOpeningRef.current = false
    }
    captionWindow.document.title = 'Living Word Captions'
    captionWindow.document.body.className = 'caption-document'
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((stylesheet) => {
      captionWindow.document.head.append(stylesheet.cloneNode(true))
    })

    const container = captionWindow.document.createElement('div')
    captionWindow.document.body.append(container)
    const root = createRoot(container)
    captionWindowRef.current = captionWindow
    captionRootRef.current = root
    root.render(<CaptionWindow content={content} />)
    setIsOpen(true)

    captionWindow.addEventListener(
      'pagehide',
      () => {
        if (captionWindowRef.current !== captionWindow) return
        const captionRoot = captionRootRef.current
        captionRootRef.current = null
        captionWindowRef.current = null
        setIsOpen(false)
        captionRoot?.unmount()
      },
      { once: true },
    )
    return true
  }

  const close = () => {
    const captionWindow = captionWindowRef.current
    const captionRoot = captionRootRef.current
    captionRootRef.current = null
    captionWindowRef.current = null
    setIsOpen(false)
    captionRoot?.unmount()
    captionWindow?.close()
  }

  const toggle = async () => {
    if (captionWindowRef.current && !captionWindowRef.current.closed) {
      close()
      return true
    }
    return open()
  }

  return { isSupported, isOpen, toggle }
}

function CaptionWindow({ content }: { content: CaptionContent }) {
  const [fontSize, setFontSize] = useState(26)

  return (
    <main className="caption-window">
      <div className="caption-toolbar" aria-label="Floating caption font size">
        <button
          type="button"
          onClick={() => setFontSize((current) => Math.max(16, current - 2))}
          disabled={fontSize <= 16}
          aria-label="Decrease floating caption font size"
        >
          A-
        </button>
        <span>{fontSize}px</span>
        <button
          type="button"
          onClick={() => setFontSize((current) => Math.min(48, current + 2))}
          disabled={fontSize >= 48}
          aria-label="Increase floating caption font size"
        >
          A+
        </button>
      </div>
      <CaptionLine label={`Live ${content.sourceLabel}`} value={content.liveSource} fontSize={fontSize} muted />
      {content.translations.map((translation) => (
        <CaptionLine
          key={translation.label}
          label={translation.label}
          value={translation.value}
          fontSize={fontSize}
        />
      ))}
    </main>
  )
}

function CaptionLine({
  label,
  value,
  fontSize,
  muted = false,
}: {
  label: string
  value: string
  fontSize: number
  muted?: boolean
}) {
  return (
    <section
      className={`caption-line ${muted ? 'caption-source' : ''}`}
      aria-label={label}
      style={{ textAlign: 'left' }}
    >
      <p style={{ fontSize, fontFamily: "'Noto Sans SC', 'Noto Sans', sans-serif" }}>
        {value || '…'}
      </p>
    </section>
  )
}