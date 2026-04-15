import type { NoteReference } from './types.js'

export type ParsedInlineNoteReference = Pick<
  NoteReference,
  'targetNoteId' | 'label' | 'qualifier' | 'positionInBody'
>

const referenceSyntaxHint =
  'Use ![[noteId]], ![[noteId|label]], or ![[noteId|label|qualifier]].'

function invalidInlineReferenceError(position: number, rawContent: string) {
  const renderedReference = `![[${rawContent}]]`

  return new Error(
    `Inline reference "${renderedReference}" at character ${position + 1} is invalid. ${referenceSyntaxHint}`,
  )
}

export function parseInlineNoteReferences(body: string): ParsedInlineNoteReference[] {
  const references: ParsedInlineNoteReference[] = []
  let cursor = 0

  while (cursor < body.length) {
    const start = body.indexOf('![[', cursor)

    if (start === -1) {
      break
    }

    const end = body.indexOf(']]', start + 3)

    if (end === -1) {
      throw new Error(
        `Inline reference starting at character ${start + 1} is missing a closing ]]. ${referenceSyntaxHint}`,
      )
    }

    const rawContent = body.slice(start + 3, end)

    if (rawContent.includes('\n') || rawContent.includes('\r')) {
      throw invalidInlineReferenceError(start, rawContent)
    }

    const parts = rawContent.split('|').map((part) => part.trim())

    if (parts.length === 0 || parts.length > 3 || parts.some((part) => part.length === 0)) {
      throw invalidInlineReferenceError(start, rawContent)
    }

    const [targetNoteId, label, qualifier] = parts

    references.push({
      targetNoteId,
      label: label ?? null,
      qualifier: qualifier ?? null,
      positionInBody: start,
    })

    cursor = end + 2
  }

  return references
}
