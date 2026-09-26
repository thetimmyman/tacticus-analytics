import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DataState } from '@/app/components/DataState'

const skeleton = <div data-testid="skeleton">loading</div>
const errorUI = <div data-testid="errorUI">error</div>
const content = <div data-testid="content">data</div>

function renderState(props: { error: unknown; isLoading: boolean }) {
  return render(
    <DataState
      error={props.error}
      isLoading={props.isLoading}
      skeleton={skeleton}
      errorUI={errorUI}
    >
      {content}
    </DataState>
  )
}

describe('DataState', () => {
  it('renders errorUI when error is set, regardless of isLoading', () => {
    const { queryByTestId } = renderState({
      error: new Error('x'),
      isLoading: true
    })
    expect(queryByTestId('errorUI')).not.toBeNull()
    expect(queryByTestId('skeleton')).toBeNull()
    expect(queryByTestId('content')).toBeNull()
  })

  it('renders errorUI when error is set and not loading', () => {
    const { queryByTestId } = renderState({
      error: new Error('x'),
      isLoading: false
    })
    expect(queryByTestId('errorUI')).not.toBeNull()
    expect(queryByTestId('skeleton')).toBeNull()
    expect(queryByTestId('content')).toBeNull()
  })

  it('renders skeleton when loading without an error', () => {
    const { queryByTestId } = renderState({ error: null, isLoading: true })
    expect(queryByTestId('skeleton')).not.toBeNull()
    expect(queryByTestId('errorUI')).toBeNull()
    expect(queryByTestId('content')).toBeNull()
  })

  it('renders content when neither loading nor error', () => {
    const { queryByTestId } = renderState({ error: null, isLoading: false })
    expect(queryByTestId('content')).not.toBeNull()
    expect(queryByTestId('skeleton')).toBeNull()
    expect(queryByTestId('errorUI')).toBeNull()
  })

  it('error takes precedence over loading (error-first order)', () => {
    const { queryByTestId } = renderState({ error: 'boom', isLoading: true })
    expect(queryByTestId('errorUI')).not.toBeNull()
    expect(queryByTestId('skeleton')).toBeNull()
  })

  it('adds no wrapper element of its own (content node is a direct child of the root)', () => {
    const { container } = renderState({ error: null, isLoading: false })
    expect(container.childNodes).toHaveLength(1)
    const only = container.firstElementChild as HTMLElement
    expect(only.getAttribute('data-testid')).toBe('content')
  })
})
