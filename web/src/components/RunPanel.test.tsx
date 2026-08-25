import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RunPanel, insertField, parseInput } from './RunPanel'
import { initialRunState, type RunState } from '../state/runReducer'
import type { AssistantSchemas } from '../api/types'

const schemas: AssistantSchemas = {
  graph_id: 'approval',
  input_schema: {
    type: 'object',
    title: 'State',
    properties: { request: { type: 'string' }, amount: { type: 'number' } },
    required: ['request', 'amount'],
  },
}

const run = (over: Partial<RunState> = {}): RunState => ({ ...initialRunState, ...over })

const setup = (over: Partial<Parameters<typeof RunPanel>[0]> = {}) => {
  const onRun = vi.fn()
  const onResume = vi.fn()
  const onCancel = vi.fn()
  render(
    <RunPanel
      schemas={schemas}
      run={run()}
      isActive={false}
      hasThread
      parked={false}
      disabled={false}
      onRun={onRun}
      onResume={onResume}
      onCancel={onCancel}
      onNewThread={vi.fn()}
      {...over}
    />,
  )
  return { onRun, onResume, onCancel, user: userEvent.setup() }
}

describe('running', () => {
  test('the input starts empty rather than pre-filled with the whole state', () => {
    setup()
    // LangGraph marks every field of a TypedDict state as required, so seeding
    // from `required` would hand the graph a wall of empty strings that
    // overwrite whatever its nodes would have defaulted to.
    expect(screen.getByLabelText(/input/i)).toHaveValue('{}')
  })

  test('invalid JSON blocks the run and says why', async () => {
    const { onRun, user } = setup()
    const box = screen.getByLabelText(/input/i)

    await user.clear(box)
    // userEvent reads a lone `{` as a key descriptor; `{{` types a literal one.
    await user.type(box, '{{not json')

    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled()
    expect(onRun).not.toHaveBeenCalled()
  })

  test('a valid object is passed through as parsed JSON', async () => {
    const { onRun, user } = setup()
    const box = screen.getByLabelText(/input/i)

    await user.clear(box)
    await user.type(box, '{{"amount": 5}')
    await user.click(screen.getByRole('button', { name: /^run$/i }))

    expect(onRun).toHaveBeenCalledWith({ amount: 5 })
  })
})

describe('a thread parked on an interrupt', () => {
  const parkedRun = run({
    status: 'interrupted',
    interrupt: { value: { question: 'Approve refund #4417?', options: ['approve', 'reject'] } },
  })

  test('Run is disabled, because running would restart the graph from the beginning', () => {
    setup({ parked: true, run: parkedRun })
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled()
    expect(screen.getByText(/starting a run would begin the graph again/i)).toBeInTheDocument()
  })

  test('the interrupt question and its options are offered', () => {
    setup({ parked: true, run: parkedRun })
    expect(screen.getByText('Approve refund #4417?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reject' })).toBeInTheDocument()
  })

  test('choosing an option resumes with that value', async () => {
    const { onResume, user } = setup({ parked: true, run: parkedRun })
    await user.click(screen.getByRole('button', { name: 'approve' }))
    expect(onResume).toHaveBeenCalledWith('approve')
  })

  test('a typed reply is coerced when it is obviously a number or boolean', async () => {
    const { onResume, user } = setup({ parked: true, run: parkedRun })
    await user.type(screen.getByPlaceholderText(/resume value/i), '42')
    await user.click(screen.getByRole('button', { name: /resume/i }))
    expect(onResume).toHaveBeenCalledWith(42)
  })
})

describe('an active run', () => {
  test('offers Cancel instead of Run', async () => {
    const { onCancel, user } = setup({ isActive: true, run: run({ status: 'running' }) })
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel run/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('parseInput', () => {
  test('an empty box means no input, which is how you continue an existing thread', () => {
    expect(parseInput('   ')).toEqual({ ok: true, value: null })
  })

  test('arrays and scalars are rejected: the graph takes an object', () => {
    expect(parseInput('[1,2]').ok).toBe(false)
    expect(parseInput('"hello"').ok).toBe(false)
    expect(parseInput('7').ok).toBe(false)
  })

  test('an object parses', () => {
    expect(parseInput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
})

describe('insertField', () => {
  test('adds a field to whatever is already typed', () => {
    expect(JSON.parse(insertField('{"a":1}', 'b', ''))).toEqual({ a: 1, b: '' })
  })

  test('clicking the same field again removes it', () => {
    expect(JSON.parse(insertField('{"a":1,"b":""}', 'b', ''))).toEqual({ a: 1 })
  })

  test('unparseable text is replaced rather than silently discarded alongside the new field', () => {
    expect(JSON.parse(insertField('{broken', 'b', 2))).toEqual({ b: 2 })
  })
})
