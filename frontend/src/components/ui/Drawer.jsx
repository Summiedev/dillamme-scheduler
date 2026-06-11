import { useEffect, useRef } from 'react'

export function Drawer({ open, onClose, title, children, side = 'right', size = 'md' }) {
  const overlayRef = useRef(null)

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-full',
  }

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === overlayRef.current) onClose()
        }}
      />
      <div
        className={`absolute top-0 ${side === 'right' ? 'right-0 h-full' : 'left-0 h-full'} ${widths[size]} w-full bg-surface-50 border-l border-border shadow-xl transform transition-transform duration-200 ease-out ${
          open
            ? 'translate-x-0'
            : side === 'right'
            ? 'translate-x-full'
            : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <button
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-surface-200 transition-colors"
            onClick={onClose}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-49px)]">
          {children}
        </div>
      </div>
    </div>
  )
}