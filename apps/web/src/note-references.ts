export interface InlineNoteReference {
  noteId: string
  label: string | null
  qualifier: string | null
}

const inlineNoteReferencePattern = /!\[\[([^\]\n]+?)\]\]/g
const internalNoteReferenceLinkPrefix = '/__dnd_note_ref__/'
const internalNoteReferenceLinkPattern =
  /\[([^\]]+)\]\(\/__dnd_note_ref__\/([^)\s]+)(?:\s+"((?:[^"]|\\")*)")?\)/g

function normalizeReferencePart(value: string | undefined) {
  const normalizedValue = value?.trim()

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null
}

export function parseInlineNoteReferenceText(rawParts: string): InlineNoteReference | null {
  const [noteIdPart, labelPart, qualifierPart, ...extraParts] = rawParts.split('|')

  if (extraParts.length > 0) {
    return null
  }

  const noteId = noteIdPart.trim()

  if (noteId.length === 0) {
    return null
  }

  return {
    noteId,
    label: normalizeReferencePart(labelPart),
    qualifier: normalizeReferencePart(qualifierPart),
  }
}

function escapeMarkdownLinkText(value: string) {
  return value.replace(/[[\]\\]/g, '\\$&')
}

function escapeMarkdownTitle(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function unescapeMarkdownText(value: string) {
  return value.replace(/\\([\\[\]"])/g, '$1')
}

export function createInternalNoteReferenceHref(noteId: string) {
  return `${internalNoteReferenceLinkPrefix}${encodeURIComponent(noteId)}`
}

export function getInlineNoteReferenceDisplayText(reference: InlineNoteReference) {
  return reference.label ?? reference.noteId
}

export function formatInlineNoteReference(reference: InlineNoteReference) {
  const displayText = getInlineNoteReferenceDisplayText(reference)

  if (!reference.qualifier && displayText === reference.noteId) {
    return `![[${reference.noteId}]]`
  }

  if (!reference.qualifier) {
    return `![[${reference.noteId}|${displayText}]]`
  }

  return `![[${reference.noteId}|${displayText}|${reference.qualifier}]]`
}

export function replaceInlineNoteReferences(
  markdown: string,
  replacer: (reference: InlineNoteReference, match: string) => string,
) {
  return markdown.replace(inlineNoteReferencePattern, (match, rawParts: string) => {
    const reference = parseInlineNoteReferenceText(rawParts)

    return reference ? replacer(reference, match) : match
  })
}

export function extractInlineNoteReferences(markdown: string) {
  const references: InlineNoteReference[] = []

  replaceInlineNoteReferences(markdown, (reference, match) => {
    references.push(reference)
    return match
  })

  return references
}

function replaceInlineNoteReferencesOutsideCode(
  markdown: string,
  replacer: (reference: InlineNoteReference, match: string) => string,
) {
  let output = ''
  let cursor = 0

  while (cursor < markdown.length) {
    const fenceIndex = markdown.indexOf('```', cursor)
    const inlineCodeIndex = markdown.indexOf('`', cursor)
    const nextSpecialIndex = [fenceIndex, inlineCodeIndex]
      .filter((index) => index >= 0)
      .reduce<number | null>((lowestIndex, index) => {
        if (lowestIndex === null || index < lowestIndex) {
          return index
        }

        return lowestIndex
      }, null)

    if (nextSpecialIndex === null) {
      output += replaceInlineNoteReferences(markdown.slice(cursor), replacer)
      break
    }

    output += replaceInlineNoteReferences(markdown.slice(cursor, nextSpecialIndex), replacer)

    if (fenceIndex === nextSpecialIndex) {
      const closingFenceIndex = markdown.indexOf('```', nextSpecialIndex + 3)
      const fenceEndIndex = closingFenceIndex >= 0 ? closingFenceIndex + 3 : markdown.length

      output += markdown.slice(nextSpecialIndex, fenceEndIndex)
      cursor = fenceEndIndex
      continue
    }

    const closingInlineCodeIndex = markdown.indexOf('`', nextSpecialIndex + 1)
    const inlineCodeEndIndex =
      closingInlineCodeIndex >= 0 ? closingInlineCodeIndex + 1 : markdown.length

    output += markdown.slice(nextSpecialIndex, inlineCodeEndIndex)
    cursor = inlineCodeEndIndex
  }

  return output
}

export function inlineNoteReferencesToMarkdownLinks(markdown: string) {
  return replaceInlineNoteReferencesOutsideCode(markdown, (reference) => {
    const displayText = escapeMarkdownLinkText(getInlineNoteReferenceDisplayText(reference))
    const title = reference.qualifier
      ? ` "${escapeMarkdownTitle(reference.qualifier)}"`
      : ''

    return `[${displayText}](${createInternalNoteReferenceHref(reference.noteId)}${title})`
  })
}

export function markdownLinksToInlineNoteReferences(markdown: string) {
  return markdown.replace(
    internalNoteReferenceLinkPattern,
    (_match, label: string, encodedNoteId: string, qualifier: string | undefined) => {
      const noteId = decodeURIComponent(encodedNoteId)

      return formatInlineNoteReference({
        noteId,
        label: normalizeReferencePart(unescapeMarkdownText(label)),
        qualifier: normalizeReferencePart(
          qualifier ? unescapeMarkdownText(qualifier) : undefined,
        ),
      })
    },
  )
}

export function stripInlineNoteReferenceSyntax(markdown: string) {
  return replaceInlineNoteReferences(markdown, (reference) =>
    getInlineNoteReferenceDisplayText(reference),
  )
}

export function isInternalNoteReferenceHref(href: string) {
  return href.startsWith(internalNoteReferenceLinkPrefix)
}

export function getNoteIdFromInternalReferenceHref(href: string) {
  if (!isInternalNoteReferenceHref(href)) {
    return null
  }

  return decodeURIComponent(href.slice(internalNoteReferenceLinkPrefix.length))
}
