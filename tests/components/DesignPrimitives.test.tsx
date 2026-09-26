import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  BarMeter,
  ConfirmDialog,
  DataTable,
  FormRow,
  ModeTogglePillGroup,
  SeasonSelectorPills,
  SnapPointSlider,
  TabbedNotesEditor,
  type DataTableColumn
} from '@/app/components/ui'

describe('Design primitives accessibility', () => {
  it('associates FormRow labels with native controls when htmlFor is provided', () => {
    render(
      <FormRow label="Role" htmlFor="role-input" helper="Discord snowflake">
        {({ describedBy }) => (
          <input id="role-input" aria-describedby={describedBy} />
        )}
      </FormRow>
    )

    const input = screen.getByLabelText('Role')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription('Discord snowflake')
  })

  it('supports keyboard changes on SnapPointSlider', () => {
    const onChange = vi.fn()
    render(
      <SnapPointSlider snaps={[20, 40, 60]} value={40} onChange={onChange} />
    )

    const slider = screen.getByRole('slider', { name: /threshold selection/i })
    expect(slider).toHaveAttribute('aria-valuenow', '40')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(60)
  })

  it('supports roving keyboard selection for mode radio groups', () => {
    const onChange = vi.fn()
    render(
      <ModeTogglePillGroup
        value="skip"
        onChange={onChange}
        options={[
          { value: 'skip', label: 'Skip' },
          { value: 'kill', label: 'Kill' },
          { value: 'threshold', label: 'Threshold' }
        ]}
      />
    )

    const group = screen.getByRole('radiogroup', { name: /mode selection/i })
    fireEvent.keyDown(group, { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith('kill')
    expect(screen.getByRole('radio', { name: 'Skip' })).toHaveClass(
      'min-h-[44px]'
    )
  })

  it('disables all controls in a disabled mode radio group', () => {
    render(
      <ModeTogglePillGroup
        value="skip"
        onChange={() => {}}
        disabled
        options={[
          { value: 'skip', label: 'Skip' },
          { value: 'kill', label: 'Kill' }
        ]}
      />
    )

    expect(screen.getByRole('radiogroup')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Skip' })).toBeDisabled()
  })

  it('supports roving keyboard selection for season radio groups', () => {
    const onChange = vi.fn()
    render(
      <SeasonSelectorPills
        value="current"
        onChange={onChange}
        options={[
          { value: 'current', label: 'Current' },
          { value: 'next', label: 'Next' }
        ]}
      />
    )

    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('next')
  })

  it('renders notes editor with tab semantics', () => {
    render(<TabbedNotesEditor value="**Saved**" onChange={() => {}} />)

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    render(
      <TabbedNotesEditor
        value="**Saved**"
        onChange={() => {}}
        defaultTab="edit"
      />
    )

    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders disabled notes editor controls when disabled', () => {
    render(<TabbedNotesEditor value="Saved" onChange={() => {}} disabled />)

    expect(screen.getByRole('tab', { name: 'Preview' })).toBeDisabled()
  })

  it('labels confirm dialogs by their visible title and closes on Escape', () => {
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open
        title="Delete mapping"
        description="This cannot be undone."
        onCancel={onCancel}
        onConfirm={() => {}}
      />
    )

    expect(
      screen.getByRole('dialog', { name: 'Delete mapping' })
    ).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('supports keyboard sorting while preserving native row semantics', () => {
    const onRowClick = vi.fn()
    type Row = { id: string; name: string; score: number }
    const rows: Row[] = [
      { id: 'a', name: 'Alpha', score: 1 },
      { id: 'b', name: 'Beta', score: 2 }
    ]
    const columns: DataTableColumn<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (row) => row.name,
        sortValue: (row) => row.name
      },
      {
        key: 'score',
        header: 'Score',
        render: (row) => row.score,
        sortValue: (row) => row.score
      }
    ]

    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Score' }))
    const targetRow = screen
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Beta'))
    expect(targetRow).not.toHaveAttribute('tabindex')
    fireEvent.click(targetRow!)

    expect(onRowClick).toHaveBeenCalledWith(rows[1])
  })

  it('gives BarMeter progressbars an accessible name', () => {
    render(<BarMeter value={42} label="Token uptake" />)

    expect(
      screen.getByRole('progressbar', { name: 'Token uptake' })
    ).toHaveAttribute('aria-valuenow', '42')
  })
})
