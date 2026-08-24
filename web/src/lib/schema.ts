/** Turn a JSON Schema into an editable starting value for the input box. */
import type { JsonSchema } from '../api/types'

export function sampleFromSchema(schema: JsonSchema | null | undefined, depth = 0): unknown {
  if (!schema || depth > 4) return null

  if (schema.default !== undefined && schema.default !== null) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  // `anyOf` is how Pydantic spells Optional[...]; pick the first real branch.
  const union = schema.anyOf ?? schema.allOf
  if (union?.length) {
    const concrete = union.find((entry) => entry.type !== 'null') ?? union[0]
    return sampleFromSchema(concrete, depth + 1)
  }

  switch (schema.type) {
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        result[key] = sampleFromSchema(child, depth + 1)
      }
      return result
    }
    case 'array':
      return []
    case 'string':
      return ''
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    default:
      return schema.properties ? sampleFromSchema({ ...schema, type: 'object' }, depth) : null
  }
}

export interface FieldHint {
  name: string
  type: string
  sample: unknown
}

/**
 * The input fields a graph accepts, as clickable hints.
 *
 * `required` is not a useful filter here: LangGraph derives the input schema
 * from the state TypedDict, which marks every key required even though nodes
 * normally supply their own defaults.
 */
export function schemaFieldHints(schema: JsonSchema | null | undefined): FieldHint[] {
  if (!schema?.properties) return []
  return Object.entries(schema.properties).map(([name, child]) => ({
    name,
    type: typeName(child),
    sample: sampleFromSchema(child, 1),
  }))
}

function typeName(schema: JsonSchema): string {
  const union = schema.anyOf ?? schema.allOf
  if (union?.length) {
    const concrete = union.find((entry) => entry.type !== 'null')
    if (concrete) return typeName(concrete)
  }
  if (schema.type === 'array') return schema.items ? `${typeName(schema.items)}[]` : 'array'
  return typeof schema.type === 'string' ? schema.type : 'any'
}

export function describeSchema(schema: JsonSchema | null | undefined): string {
  if (!schema) return 'not published by this graph'
  const keys = Object.keys(schema.properties ?? {})
  if (keys.length === 0) return schema.type ?? 'unknown'
  return `${keys.length} field${keys.length === 1 ? '' : 's'}`
}
