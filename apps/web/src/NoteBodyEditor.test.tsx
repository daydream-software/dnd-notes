import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NoteBodyEditor from './NoteBodyEditor'

function ControlledNoteBodyEditor({ initialBody = '' }: { initialBody?: string }) {
  const [body, setBody] = useState(initialBody)

  return <NoteBodyEditor body={body} onChange={setBody} surfaceRadius="24px" />
}

describe('NoteBodyEditor', () => {
  it('defaults to editor mode and renders source dividers as real editor content', async () => {
    const { container } = render(
      <NoteBodyEditor
        body={['Before the break', '', '---', '', 'After the break'].join('\n')}
        onChange={vi.fn()}
        surfaceRadius="24px"
      />,
    )

    expect(screen.getByRole('button', { name: 'Editor' })).toBeTruthy()
    expect(screen.getByLabelText('Body editor')).toBeTruthy()
    expect(container.textContent).not.toContain('---')
  })

  it('surfaces heading and divider support in both editor modes', async () => {
    const user = userEvent.setup()
    const { container } = render(<NoteBodyEditor body="" onChange={vi.fn()} surfaceRadius="24px" />)
    const editorScope = within(container)

    expect(editorScope.getAllByText(/without markdown syntax/i).length).toBeGreaterThan(0)

    await user.click(editorScope.getByRole('button', { name: 'Source' }))

    expect(
      editorScope.getByText(/including headings \(#\) and dividers \(---\)/i),
    ).toBeTruthy()

    await user.click(editorScope.getByRole('button', { name: 'Editor' }))

    expect(editorScope.getByRole('button', { name: 'H1' })).toBeTruthy()
    expect(editorScope.getByRole('button', { name: 'H2' })).toBeTruthy()
    expect(editorScope.getByRole('button', { name: 'H3' })).toBeTruthy()
    expect(editorScope.getByRole('button', { name: 'Horizontal rule' })).toBeTruthy()
  })

  it('keeps the current body when switching between source and editor', async () => {
    const user = userEvent.setup()
    const { container } = render(<ControlledNoteBodyEditor />)
    const editorScope = within(container)

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await user.type(editorScope.getByLabelText('Body'), 'Campfire clue')

    await user.click(editorScope.getByRole('button', { name: 'Editor' }))
    await waitFor(() => {
      expect(within(editorScope.getByLabelText('Body editor')).getByText('Campfire clue')).toBeTruthy()
    })

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      expect((editorScope.getByLabelText('Body') as HTMLTextAreaElement).value).toContain(
        'Campfire clue',
      )
    })
  })
})
