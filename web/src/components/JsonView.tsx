/** A compact, collapsible JSON tree. Everything the inspector shows is JSON. */
import { memo, useState } from 'react'
import { summarize } from '../lib/format'

/**
 * How many children of one container render before the rest are collapsed
 * behind a button. A `messages` array of 2 000 entries produced ~46 000 DOM
 * nodes that React then re-reconciled on every streamed event.
 */
const CHILDREN_PER_PAGE = 100

interface JsonViewProps {
  value: unknown
  /** Levels expanded on first render. */
  defaultDepth?: number
  name?: string
}

export function JsonView({ value, defaultDepth = 2, name }: JsonViewProps) {
  return (
    <div className="json">
      <JsonNode value={value} depth={0} defaultDepth={defaultDepth} name={name} isLast />
    </div>
  )
}

interface NodeProps {
  value: unknown
  depth: number
  defaultDepth: number
  name?: string
  isLast: boolean
}

const JsonNode = memo(function JsonNode({ value, depth, defaultDepth, name, isLast }: NodeProps) {
  const [open, setOpen] = useState(depth < defaultDepth)
  const [shown, setShown] = useState(CHILDREN_PER_PAGE)

  if (!isContainer(value)) {
    return (
      <div className="json-row" style={indent(depth)}>
        {name !== undefined && <span className="json-key">{name}</span>}
        <JsonScalar value={value} />
        {!isLast && <span className="json-punct">,</span>}
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const [openBrace, closeBrace] = Array.isArray(value) ? ['[', ']'] : ['{', '}']

  if (entries.length === 0) {
    return (
      <div className="json-row" style={indent(depth)}>
        {name !== undefined && <span className="json-key">{name}</span>}
        <span className="json-punct">
          {openBrace}
          {closeBrace}
        </span>
        {!isLast && <span className="json-punct">,</span>}
      </div>
    )
  }

  return (
    <div className="json-branch">
      <div className="json-row json-row-toggle" style={indent(depth)} onClick={() => setOpen((prev) => !prev)}>
        <button className="json-caret" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} type="button">
          {open ? '▾' : '▸'}
        </button>
        {name !== undefined && <span className="json-key">{name}</span>}
        <span className="json-punct">{openBrace}</span>
        {!open && (
          <>
            <span className="json-collapsed">{summarize(value, 48)}</span>
            <span className="json-punct">{closeBrace}</span>
            {!isLast && <span className="json-punct">,</span>}
          </>
        )}
        {open && <span className="json-count">{entries.length}</span>}
      </div>
      {open && (
        <>
          {entries.slice(0, shown).map(([key, child], index) => (
            <JsonNode
              key={key}
              name={Array.isArray(value) ? undefined : key}
              value={child}
              depth={depth + 1}
              defaultDepth={defaultDepth}
              isLast={index === entries.length - 1}
            />
          ))}
          {entries.length > shown && (
            <div className="json-row" style={indent(depth + 1)}>
              <button
                type="button"
                className="link-btn"
                onClick={() => setShown((current) => current + CHILDREN_PER_PAGE * 5)}
              >
                show {Math.min(CHILDREN_PER_PAGE * 5, entries.length - shown)} more of {entries.length}
              </button>
            </div>
          )}
          <div className="json-row" style={indent(depth)}>
            <span className="json-punct">{closeBrace}</span>
            {!isLast && <span className="json-punct">,</span>}
          </div>
        </>
      )}
    </div>
  )
})

function JsonScalar({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>
  if (value === undefined) return <span className="json-null">undefined</span>
  switch (typeof value) {
    case 'string':
      return <span className="json-string">{value.includes('\n') ? <MultilineString value={value} /> : `"${value}"`}</span>
    case 'number':
      return <span className="json-number">{String(value)}</span>
    case 'boolean':
      return <span className="json-boolean">{String(value)}</span>
    default:
      return <span className="json-string">{String(value)}</span>
  }
}

/** Long multi-line strings -- drafts, prompts -- read better as a block. */
function MultilineString({ value }: { value: string }) {
  return <pre className="json-multiline">{value}</pre>
}

function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 13}px` }
}
