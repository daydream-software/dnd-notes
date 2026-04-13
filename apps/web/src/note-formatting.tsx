import { Box, Link, Typography } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownSx } from './note-markdown-styles'

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
            return <Link {...props} rel="noreferrer" target="_blank" />
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </Box>
  )
}
