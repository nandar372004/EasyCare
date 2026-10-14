import { useCallback, useEffect, useRef } from 'react'

export function useChatScroll(items) {
  const scrollRef = useRef(null)
  const followLatest = useRef(true)
  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 120
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (element && followLatest.current) element.scrollTop = element.scrollHeight
  }, [items])

  return { scrollRef, onScroll }
}
