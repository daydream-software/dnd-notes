import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from './note-excerpts'
import { NoteBodyPreview } from './note-formatting'

describe('NoteBodyPreview', () => {
  it('renders markdown headings, lists, emphasis, and links', () => {
    const { container } = render(
      <NoteBodyPreview
        body={[
          '# Harbor watch',
          '',
          'The **signal fire** is ready.',
          '',
          '- Bring cloaks',
          '- Bring rope',
          '',
          '---',
          '',
          '[Map room](https://example.com/map-room)',
        ].join('\n')}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Harbor watch' }),
    ).toBeTruthy()
    expect(screen.getByText('signal fire').tagName).toBe('STRONG')
    expect(screen.getByText('Bring cloaks').closest('li')).toBeTruthy()
    expect(container.querySelector('hr')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Map room' }).getAttribute('href'),
    ).toBe('https://example.com/map-room')
  })

  it('keeps empty notes readable with an explicit placeholder', () => {
    render(<NoteBodyPreview ariaLabel="Note body preview" body="" />)

    expect(screen.getByLabelText('Note body preview').textContent).toContain(
      'Nothing to preview yet.',
    )
  })

  it('converts markdown into readable plain text for excerpts', () => {
    expect(
      markdownToPlainText(
        [
          '# Harbor watch',
          '',
          'The **signal fire** is ready for [Map room](https://example.com/map-room).',
          '',
          '- Bring cloaks',
          '- Bring rope',
          '',
          '---',
          '',
          '`Quietly.`',
        ].join('\n'),
      ),
    ).toBe('Harbor watch The signal fire is ready for Map room. Bring cloaks Bring rope Quietly.')
  })
})
