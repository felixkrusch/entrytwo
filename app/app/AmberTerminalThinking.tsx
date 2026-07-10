'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

const MESSAGE_KEYS = [
  'thinking',
  'requestingData',
  'loading',
  'receiving',
  'analyzing',
  'processing',
  'syncingEntries',
  'balancing',
] as const

export default function AmberTerminalThinking() {
  const t = useTranslations('app.chat')
  const [displayText, setDisplayText] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)

  useEffect(() => {
    // Build messages fresh inside the effect (stable for this run)
    const msgs = MESSAGE_KEYS.map((key) =>
      t(`thinkingMessages.${key}`).toLowerCase()
    )

    let typingInterval: ReturnType<typeof setInterval> | null = null
    let deletingInterval: ReturnType<typeof setInterval> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    let currentIndex = 0
    let currentText = ''
    let isDeleting = false

    function getNextMessageIndex(): number {
      if (msgs.length <= 1) return 0
      let next: number
      do {
        next = Math.floor(Math.random() * msgs.length)
      } while (next === currentIndex)
      return next
    }

    function startTyping() {
      currentIndex = getNextMessageIndex()
      const fullText = msgs[currentIndex]
      currentText = ''
      isDeleting = false
      setDisplayText('')

      typingInterval = setInterval(() => {
        if (currentText.length < fullText.length) {
          currentText = fullText.slice(0, currentText.length + 1)
          setDisplayText(currentText)
        } else {
          if (typingInterval) clearInterval(typingInterval);

          // Add a space after the last letter so the cursor sits after it
          const textWithSpace = fullText + ' ';
          setDisplayText(textWithSpace);
          currentText = textWithSpace;

          // Wait before starting to delete
          setTimeout(() => {
            startDeleting(textWithSpace);
          }, 2300);
        }
      }, 110)
    }

    function startDeleting(fullText: string) {
      isDeleting = true
      let i = fullText.length

      deletingInterval = setInterval(() => {
        if (i > 0) {
          i--
          currentText = fullText.slice(0, i)
          setDisplayText(currentText)
        } else {
          if (deletingInterval) clearInterval(deletingInterval)
          timeout = setTimeout(() => {
            startTyping()
          }, 450)
        }
      }, 70)
    }

    // Cursor blink
    const cursorBlink = setInterval(() => {
      setCursorVisible((v) => !v)
    }, 530)

    // Kick off after small delay (matches original demo)
    timeout = setTimeout(() => {
      startTyping()
    }, 600)

    return () => {
      if (typingInterval) clearInterval(typingInterval)
      if (deletingInterval) clearInterval(deletingInterval)
      if (timeout) clearTimeout(timeout)
      clearInterval(cursorBlink)
    }
  }, [t])

  return (
    <span
      className="text-sm text-amber-500 whitespace-nowrap"
      style={{ textShadow: '0 0 6px rgba(245, 158, 11, 0.45)' }}
    >
      {displayText}
      <span
        className="inline-block w-[9px] h-[14px] ml-px align-[-1px] bg-amber-500"
        style={{ opacity: cursorVisible ? 1 : 0, transition: 'opacity 80ms step-end' }}
      />
    </span>
  )
}
