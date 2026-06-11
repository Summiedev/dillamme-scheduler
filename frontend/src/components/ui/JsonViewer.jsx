import { useState } from 'react'

function stringifyValue(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'object') return null
  return String(value)
}

function JsonNode({ label, value, depth = 0, defaultOpen = true }) {
  const [collapsed, setCollapsed] = useState(depth > 2 ? !defaultOpen : !defaultOpen)

  const isObject = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const entries = isObject ? (isArray ? value : Object.entries(value)) : []
  const isEmpty = isObject && entries.length === 0

  const indent = depth * 16

  if (!isObject) {
    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: indent }}>
        {label !== null && (
          <span className="text-accent shrink-0">
            {typeof label === 'number' ? (
              <span className="text-text-secondary">{label}</span>
            ) : (
              <span>"{label}"</span>
            )}
            <span className="text-text-muted mx-1">:</span>
          </span>
        )}
        <span className={`break-all font-mono text-xs ${
          value === null ? 'text-text-muted' :
          typeof value === 'string' ? 'text-success' :
          typeof value === 'number' ? 'text-warning' :
          typeof value === 'boolean' ? 'text-accent' : 'text-text'
        }`}>
          {stringifyValue(value)}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 cursor-pointer hover:bg-surface-100/50 rounded-sm py-0.5 select-none"
        style={{ paddingLeft: indent }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform duration-100 ${collapsed ? '' : 'rotate-90'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-text-muted text-xs font-mono">
          {label !== null && (
            <>
              {typeof label === 'number' ? (
                <span className="text-text-secondary">{label}</span>
              ) : (
                <span className="text-accent">"{label}"</span>
              )}
              <span className="text-text-muted mx-0.5">:</span>
            </>
          )}
          <span className="text-text-secondary">
            {isArray ? `[${value.length}]` : '{...}'}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div>
          {isEmpty ? (
            <div className="text-text-muted text-xs font-mono" style={{ paddingLeft: indent + 16 }}>
              {isArray ? '[]' : '{}'}
            </div>
          ) : (
            <>
              {isArray ? (
                value.map((item, idx) => (
                  <JsonNode key={idx} label={idx} value={item} depth={depth + 1} />
                ))
              ) : (
                entries.map(([key, val]) => (
                  <JsonNode key={key} label={key} value={val} depth={depth + 1} />
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function JsonViewer({ data, defaultOpen = false }) {
  return (
    <div className="bg-surface-100 rounded-lg p-3 border border-border overflow-x-auto">
      <JsonNode label={null} value={data} depth={0} defaultOpen={defaultOpen} />
    </div>
  )
}