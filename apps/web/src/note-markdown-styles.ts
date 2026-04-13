export const markdownSx = {
  '& > :first-of-type': {
    mt: 0,
  },
  '& > :last-child': {
    mb: 0,
  },
  '& h1, & h2, & h3, & h4, & h5, & h6': {
    mt: 2.5,
    mb: 1,
    lineHeight: 1.2,
  },
  '& h1': {
    fontSize: { xs: '1.7rem', sm: '2rem' },
  },
  '& h2': {
    fontSize: { xs: '1.45rem', sm: '1.7rem' },
  },
  '& h3': {
    fontSize: { xs: '1.25rem', sm: '1.45rem' },
  },
  '& p': {
    my: 1.25,
  },
  '& ul, & ol': {
    my: 1.25,
    pl: 3,
  },
  '& li + li': {
    mt: 0.5,
  },
  '& a': {
    wordBreak: 'break-word',
  },
  '& blockquote': {
    borderLeft: '4px solid',
    borderColor: 'divider',
    color: 'text.secondary',
    m: 0,
    my: 1.5,
    pl: 2,
  },
  '& code': {
    bgcolor: 'action.hover',
    borderRadius: 1,
    fontFamily:
      'ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
    fontSize: '0.9em',
    px: 0.75,
    py: 0.25,
  },
  '& pre': {
    bgcolor: 'action.hover',
    borderRadius: 2,
    my: 1.5,
    overflowX: 'auto',
    p: 1.5,
  },
  '& pre code': {
    bgcolor: 'transparent',
    p: 0,
  },
  '& hr': {
    border: 0,
    borderTop: '1px solid',
    borderColor: 'divider',
    my: 2,
  },
  '& table': {
    borderCollapse: 'collapse',
    my: 1.5,
    width: '100%',
  },
  '& th, & td': {
    border: '1px solid',
    borderColor: 'divider',
    p: 1,
    textAlign: 'left',
  },
} as const
