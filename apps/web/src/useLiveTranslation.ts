import type {
  ClientMessage,
  ServerMessage,
  SourceLanguage,
  TargetLanguage,
  TranslationSegment,
} from '@church/contracts'
import { useEffect, useRef, useState } from 'react'

export type SessionPhase =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'listening'
  | 'paused'
  | 'translating'
  | 'stopping'
  | 'error'

export type AudioInputMode = 'microphone' | 'system'

const mimeType = 'audio/webm;codecs=opus' as const

export function upsertTranslationSegment(
  current: TranslationSegment[],
  incoming: TranslationSegment,
) {
  const index = current.findIndex((segment) => segment.segmentId === incoming.segmentId)
  if (index === -1) return [...current, incoming]
  const next = [...current]
  next[index] = { ...next[index], ...incoming }
  return next
}

export function getMediaAccessError(isSecureContext: boolean, hasGetUserMedia: boolean) {
  if (!isSecureContext) {
    return 'Microphone access requires HTTPS. Only this computer can use http://localhost.'
  }
  if (!hasGetUserMedia) {
    return 'This browser does not support microphone access. Use the latest Chrome or Edge.'
  }
  return ''
}

export function useLiveTranslation() {
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [inputMode, setInputMode] = useState<AudioInputMode>('microphone')
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('en-AU')
  const [targetLanguages, setTargetLanguages] = useState<TargetLanguage[]>([
    'en',
    'zh-Hans',
    'id',
  ])
  const [segments, setSegments] = useState<TranslationSegment[]>([])
  const [interim, setInterim] = useState('')
  const [volume, setVolume] = useState(0)
  const [queueDepth, setQueueDepth] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState(15)

  const socketRef = useRef<WebSocket>(null)
  const streamRef = useRef<MediaStream>(null)
  const displayStreamRef = useRef<MediaStream>(null)
  const recorderRef = useRef<MediaRecorder>(null)
  const audioContextRef = useRef<AudioContext>(null)
  const animationRef = useRef<number>(undefined)

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const available = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    )
    setDevices(available)
    setSelectedDeviceId((current) =>
      available.some((device) => device.deviceId === current)
        ? current
        : (available[0]?.deviceId ?? ''),
    )
  }

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
      socketRef.current?.close()
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      displayStreamRef.current?.getVideoTracks().forEach((track) => {
        track.onended = null
      })
      displayStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      void audioContextRef.current?.close()
    }
  }, [])

  const send = (message: ClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message))
    }
  }

  const releaseMedia = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = undefined
    setVolume(0)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    displayStreamRef.current?.getVideoTracks().forEach((track) => {
      track.onended = null
    })
    displayStreamRef.current?.getTracks().forEach((track) => track.stop())
    displayStreamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    recorderRef.current = null
  }

  const beginMeter = (stream: MediaStream) => {
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    const samples = new Uint8Array(analyser.fftSize)
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    audioContextRef.current = audioContext
    let lastRenderedAt = 0

    const update = (now: number) => {
      if (now - lastRenderedAt >= 80) {
        analyser.getByteTimeDomainData(samples)
        const rootMeanSquare = Math.sqrt(
          samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) /
            samples.length,
        )
        setVolume(Math.min(1, rootMeanSquare * 4.5))
        lastRenderedAt = now
      }
      animationRef.current = requestAnimationFrame(update)
    }
    animationRef.current = requestAnimationFrame(update)
  }

  const upsertSegment = (incoming: TranslationSegment) => {
    setSegments((current) => upsertTranslationSegment(current, incoming))
  }

  const requestStop = () => {
    setPhase('stopping')
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => send({ type: 'session.stop' })
      recorder.stop()
    } else {
      send({ type: 'session.stop' })
    }
  }

  const handleServerMessage = (message: ServerMessage, socket: WebSocket) => {
    if (socketRef.current !== socket) return

    switch (message.type) {
      case 'session.ready': {
        const stream = streamRef.current
        const socket = socketRef.current
        if (!stream || !socket) return
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data)
        }
        recorderRef.current = recorder
        recorder.start(250)
        setPhase('listening')
        break
      }
      case 'session.auto_stopped':
        setNotice(
          `No speech was detected for ${message.inactivityTimeoutMinutes} minutes. Translation stopped automatically.`,
        )
        break
      case 'session.status':
        setQueueDepth(message.queueDepth ?? 0)
        if (message.status === 'connecting') setPhase('connecting')
        if (message.status === 'listening') setPhase('listening')
        if (message.status === 'paused') setPhase('paused')
        if (message.status === 'translating') setPhase('translating')
        if (message.status === 'closing') setPhase('stopping')
        break
      case 'transcript.interim':
        setInterim(message.text)
        break
      case 'transcript.final':
        setInterim('')
        upsertSegment({ ...message, translations: {}, state: 'translating' })
        break
      case 'translation.final':
        upsertSegment({ ...message, state: 'complete' })
        break
      case 'session.closed':
        socketRef.current = null
        releaseMedia()
        setPhase('idle')
        setInterim('')
        break
      case 'error':
        setError(message.message)
        if (!message.recoverable) {
          setPhase('error')
          releaseMedia()
          socketRef.current?.close()
        }
        break
    }
  }

  const start = async () => {
    setError('')
    setNotice('')
    const mediaAccessError = getMediaAccessError(
      window.isSecureContext,
      Boolean(navigator.mediaDevices?.getUserMedia),
    )
    if (mediaAccessError) {
      setError(mediaAccessError)
      setPhase('error')
      return
    }
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mimeType)) {
      setError('This browser does not support Opus recording. Use the latest Chrome, Edge, or Firefox.')
      setPhase('error')
      return
    }

    try {
      setPhase('requesting')
      let stream: MediaStream
      if (inputMode === 'system') {
        const capture = await captureSystemAudio()
        stream = capture.audioStream
        displayStreamRef.current = capture.displayStream
        const displayTrack = capture.displayStream.getVideoTracks()[0]
        if (displayTrack) displayTrack.onended = requestStop
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        })
      }
      streamRef.current = stream
      beginMeter(stream)
      if (inputMode === 'microphone') await refreshDevices()

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/ws/session`)
      socketRef.current = socket
      setPhase('connecting')
      socket.onopen = () =>
        send({
          type: 'session.start',
          sourceLanguage,
          targetLanguages,
          mimeType,
          inactivityTimeoutMinutes,
        })
      socket.onmessage = (event) => {
        try {
          handleServerMessage(JSON.parse(event.data as string) as ServerMessage, socket)
        } catch {
          setError('The server returned an invalid response.')
        }
      }
      socket.onerror = () => {
        if (socketRef.current !== socket) return
        setError('Cannot connect to the translation service. Confirm that the server is running.')
        setPhase('error')
      }
      socket.onclose = () => {
        if (socketRef.current !== socket) return
        socketRef.current = null
        releaseMedia()
        setPhase((current) => (current === 'error' ? current : 'idle'))
      }
    } catch (caught) {
      releaseMedia()
      setPhase('error')
      setError(getAudioInputError(caught, inputMode))
    }
  }

  const pause = () => {
    if (recorderRef.current?.state !== 'recording') return
    recorderRef.current.pause()
    send({ type: 'session.pause' })
    setPhase('paused')
  }

  const resume = () => {
    if (recorderRef.current?.state !== 'paused') return
    recorderRef.current.resume()
    send({ type: 'session.resume' })
    setPhase('listening')
  }

  const stop = () => {
    if (phase === 'idle' || phase === 'stopping') return
    requestStop()
  }

  return {
    phase,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    inputMode,
    setInputMode,
    sourceLanguage,
    setSourceLanguage,
    targetLanguages,
    setTargetLanguages,
    segments,
    interim,
    volume,
    queueDepth,
    error,
    notice,
    inactivityTimeoutMinutes,
    setInactivityTimeoutMinutes,
    start,
    pause,
    resume,
    stop,
    clear: () => {
      setSegments([])
      setInterim('')
    },
  }
}

async function captureSystemAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('System audio sharing is not supported. Use the latest Microsoft Edge or Chrome.')
  }

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    systemAudio: 'include',
  } as DisplayMediaStreamOptions)
  const audioTracks = displayStream.getAudioTracks()

  if (audioTracks.length === 0) {
    displayStream.getTracks().forEach((track) => track.stop())
    throw new Error('No system audio was received. Share the entire screen and enable system audio.')
  }

  return {
    audioStream: new MediaStream(audioTracks),
    displayStream,
  }
}

function getAudioInputError(error: unknown, inputMode: AudioInputMode) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return inputMode === 'system'
      ? 'System audio sharing was cancelled. Start again and enable audio in the sharing dialog.'
      : 'Microphone permission was denied. Allow microphone access in the browser and try again.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return inputMode === 'system'
      ? 'No system audio source is available.'
      : 'No microphone was found. Connect a microphone and try again.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Cannot open the audio input. Check that the device is available.'
}