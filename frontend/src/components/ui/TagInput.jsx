import { useState, useRef } from 'react'

export function TagInput({ tags = [], onChange, placeholder = 'Add tag...', suggestions = [] }) {
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef(null)

  const addTag = (tag) => {
    const trimmed = tag.trim().toLowerCase()
    if (!trimmed || tags.includes(trimmed)) return
    onChange([...tags, trimmed])
    setInput('')
    setShowSuggestions(false)
  }

  const removeTag = (tag) => {
    onChange(tags.filter((t) => t !== tag))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    }
    if (e.key === 'Backspace' && !input && tags.length) {
      removeTag(tags[tags.length - 1])
    }
  }

  const filteredSuggestions = input
    ? suggestions.filter((s) => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s))
    : suggestions.filter((s) => !tags.includes(s))

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 bg-surface-100 border border-border rounded-md focus-within:border-accent-muted focus-within:ring-1 focus-within:ring-accent/30 transition-colors min-h-[36px]">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-200 text-text-secondary text-xs rounded-sm border border-surface-300 group">
            {tag}
            <button
              className="text-text-muted hover:text-danger transition-colors"
              onClick={() => removeTag(tag)}
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={tags.length ? '' : placeholder}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface-100 border border-border rounded-md shadow-lg py-1 max-h-32 overflow-y-auto">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-200 hover:text-text text-left transition-colors"
              onClick={() => addTag(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}