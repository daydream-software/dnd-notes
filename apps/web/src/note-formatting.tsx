import { Box, Link, Typography } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownSx } from './note-markdown-styles'
import {
  getNoteIdFromInternalReferenceHref,
  inlineNoteReferencesToMarkdownLinks,
  isInternalNoteReferenceHref,
} from './note-references'

interface NoteBodyPreviewProps {
  body: string
  emptyMessage?: string
  ariaLabel?: string
}

export function NoteBodyPreview({
  body,
  emptyMessage = 'Nothing to preview yet. Markdown formatting appears here as you write.',
  ariaLabel,
}: NoteBodyPreviewProps) {
  if (body.trim().length === 0) {
    return (
      <Typography aria-label={ariaLabel} color="text.secondary" variant="body2">
        {emptyMessage}
      </Typography>
    )
  }

  return (
    <Box aria-label={ariaLabel} sx={markdownSx}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => {
            void node
            const href = props.href ?? ''

            if (isInternalNoteReferenceHref(href)) {
              const noteId = getNoteIdFromInternalReferenceHref(href)

              return (
                <Link
                  component="span"
                  title={props.title ?? noteId ?? undefined}
                  underline="none"
                  sx={{
                    alignItems: 'center',
                    backgroundColor: 'action.selected',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 999,
                    color: 'text.primary',
                    display: 'inline-flex',
                    fontWeight: 500,
                    px: 0.75,
                    py: 0.125,
                  }}
                >
                  {props.children}
                </Link>
              )
            }

            return <Link {...props} rel="noreferrer" target="_blank" />
          },
        }}
      >
        {inlineNoteReferencesToMarkdownLinks(body)}
      </ReactMarkdown>
    </Box>
  )
}
