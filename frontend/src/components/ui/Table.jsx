export function Table({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full border-collapse">
        {children}
      </table>
    </div>
  )
}

export function Thead({ children, className = '' }) {
  return (
    <thead className={className}>
      {children}
    </thead>
  )
}

export function Th({ children, className = '' }) {
  return (
    <th className={`px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-text-secondary bg-surface-100 border-b border-border ${className}`}>
      {children}
    </th>
  )
}

export function Tbody({ children, className = '' }) {
  return (
    <tbody className={`divide-y divide-border ${className}`}>
      {children}
    </tbody>
  )
}

export function Tr({ children, className = '', onClick }) {
  return (
    <tr
      className={`${onClick ? 'cursor-pointer' : ''} hover:bg-surface-100/50 transition-colors ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(e) : undefined}
    >
      {children}
    </tr>
  )
}

export function Td({ children, className = '' }) {
  return (
    <td className={`px-3 py-2.5 text-sm text-text ${className}`}>
      {children}
    </td>
  )
}