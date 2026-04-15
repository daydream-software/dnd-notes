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

  it('renders inline note references as readable pills in preview mode', () => {
    render(
      <NoteBodyPreview
        body={[
          'Check ![[storm-ledger|Storm ledger|supporting evidence]] before dawn.',
          '',
          'Fallback reference: ![[vault-sigils]].',
        ].join('\n')}
      />,
    )

    const qualifiedReference = screen.getByText('Storm ledger')
    const bareReference = screen.getByText('vault-sigils')

    expect(qualifiedReference.getAttribute('title')).toBe('supporting evidence')
    expect(bareReference.getAttribute('title')).toBe('vault-sigils')
  })

  it('converts markdown into readable plain text for excerpts', () => {
    expect(
      markdownToPlainText(
        [
          '# Harbor watch',
          '',
          'The **signal fire** is ready for [Map room](https://example.com/map-room).',
          'Cross-check ![[storm-ledger|Storm ledger|supporting evidence]] and ![[vault-sigils]].',
          '',
          '- Bring cloaks',
          '- Bring rope',
          '',
          '---',
          '',
          '`Quietly.`',
        ].join('\n'),
      ),
    ).toBe(
      'Harbor watch The signal fire is ready for Map room. Cross-check Storm ledger and vault-sigils. Bring cloaks Bring rope Quietly.',
    )
  })

  it('uses the visible label for inline note references in excerpts', () => {
    expect(
      markdownToPlainText(
        [
          'Scout the ![[harbor-watch]] route before dawn.',
          'Check ![[map-room|Map Room]] for changes.',
          'Warn ![[captain-neris|Captain Neris|npc]] before the bell.',
          'Keep [[signal-log|Signal Log|archive]] close by.',
        ].join('\n'),
      ),
    ).toBe(
      'Scout the harbor-watch route before dawn. Check Map Room for changes. Warn Captain Neris before the bell. Keep Signal Log close by.',
    )
  })
})
