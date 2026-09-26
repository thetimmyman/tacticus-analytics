import { useCallback, useState } from 'react'

export function useDisclosure(initialOpen: boolean = false) {
  const [isOpen, setIsOpen] = useState(initialOpen)
  const onOpen = useCallback(() => setIsOpen(true), [])
  const onClose = useCallback(() => setIsOpen(false), [])
  const onToggle = useCallback(() => setIsOpen((v) => !v), [])
  return { isOpen, setIsOpen, onOpen, onClose, onToggle }
}
