import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NoteBodyEditor from './NoteBodyEditor'

const noteOptions = [
  { id: 'captain-neris', title: 'Captain Neris' },
  { id: 'west-dock', title: 'West Dock' },
] as const

function ControlledNoteBodyEditor({ initialBody = '' }: { initialBody?: string }) {
  const [body, setBody] = useState(initialBody)

  return (
    <NoteBodyEditor
      body={body}
      onChange={setBody}
      surfaceRadius="24px"
      noteOptions={noteOptions}
    />
  )
}

function renderEditor(body = '') {
  return render(
    <NoteBodyEditor
      body={body}
      onChange={vi.fn()}
      surfaceRadius="24px"
      noteOptions={noteOptions}
    />,
  )
}

describe('NoteBodyEditor', () => {
  it('defaults to editor mode and renders source dividers as real editor content', async () => {
    const { container } = renderEditor(['Before the break', '', '---', '', 'After the break'].join('\n'))

    expect(screen.getByRole('button', { name: 'Editor' })).toBeTruthy()
    expect(screen.getByLabelText('Body editor')).toBeTruthy()
    expect(container.textContent).not.toContain('---')
  })

  it('surfaces heading and divider support in both editor modes', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor()
    const editorScope = within(container)

    expect(editorScope.getAllByText(/without markdown syntax/i).length).toBeGreaterThan(0)

    await user.click(editorScope.getByRole('button', { name: 'Source' }))

    expect(
      editorScope.getByText(
        /including headings \(#\), dividers \(---\), and note references like !\[\[/i,
      ),
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

  it('keeps focus on the toggle when returning to editor mode', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ControlledNoteBodyEditor initialBody={['Before the break', '', '---', '', 'After the break'].join('\n')} />,
    )
    const editorScope = within(container)
    const sourceButton = editorScope.getByRole('button', { name: 'Source' })
    const editorButton = editorScope.getByRole('button', { name: 'Editor' })

    await user.click(sourceButton)
    await user.click(editorButton)

    await waitFor(() => {
      expect(editorScope.getByLabelText('Body editor')).toBeTruthy()
      expect(document.activeElement).toBe(editorButton)
    })
  })

  it('preserves qualified inline note references when switching modes', async () => {
    const user = userEvent.setup()
    const qualifiedReferenceBody = [
      '# Dock report',
      '',
      'Meet ![[captain-neris|Captain Neris|npc]] at ![[west-dock|West Dock|location]].',
    ].join('\n')

    const { container } = render(<ControlledNoteBodyEditor initialBody={qualifiedReferenceBody} />)
    const editorScope = within(container)
    const bodyEditor = editorScope.getByLabelText('Body editor')

    expect(bodyEditor.textContent).toContain('Captain Neris')
    expect(bodyEditor.textContent).toContain('West Dock')
    expect(bodyEditor.textContent).not.toContain('![[captain-neris|Captain Neris|npc]]')
    expect(bodyEditor.querySelector('a[href^="/__dnd_note_ref__/captain-neris"]')).toBeTruthy()

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      expect((editorScope.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
        qualifiedReferenceBody,
      )
    })

    await user.click(editorScope.getByRole('button', { name: 'Editor' }))
    await waitFor(() => {
      expect(editorScope.getByLabelText('Body editor')).toBeTruthy()
    })

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      expect((editorScope.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
        qualifiedReferenceBody,
      )
    })
  })

  it('suggests note references after typing ! in source mode', async () => {
    const user = userEvent.setup()
    const { container } = render(<ControlledNoteBodyEditor />)
    const editorScope = within(container)

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await user.type(editorScope.getByLabelText('Body'), '!capt')

    expect(
      editorScope.getByRole('button', {
        name: /Captain Neris captain-neris/i,
      }),
    ).toBeTruthy()

    await user.click(
      editorScope.getByRole('button', {
        name: /Captain Neris captain-neris/i,
      }),
    )

    await waitFor(() => {
      expect((editorScope.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
        '![[captain-neris|Captain Neris]]',
      )
    })
  })

  it('inserts a qualified note reference from the note-link picker', async () => {
    const user = userEvent.setup()
    const { container } = render(<ControlledNoteBodyEditor />)
    const editorScope = within(container)

    await user.click(editorScope.getByLabelText('Body editor'))
    await user.click(editorScope.getByRole('button', { name: 'Note link' }))
    await user.click(
      screen.getByRole('button', {
        name: /Captain Neris captain-neris/i,
      }),
    )
    await user.clear(screen.getByLabelText('Qualifier'))
    await user.type(screen.getByLabelText('Qualifier'), 'npc')
    await user.click(screen.getByRole('button', { name: 'Insert reference' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    await user.click(editorScope.getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      expect((editorScope.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
        '![[captain-neris|Captain Neris|npc]]',
      )
    })
  })
})
