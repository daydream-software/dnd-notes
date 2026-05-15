import { Box, Link, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { DaydreamMark, DndNotesMark, GitHubMark } from './Marks.js'

const sectionLabelSx = {
  color: 'primary.main',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  display: 'block',
  marginBottom: 0.75,
} as const

const linkSx = {
  color: 'rgba(255, 255, 255, 0.78)',
  fontSize: 13,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  transition: 'color 160ms ease',
  '&:hover': { color: 'primary.main' },
} as const

const sigSurfaceSx = {
  bgcolor: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(167, 139, 250, 0.18)',
  borderRadius: '999px',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 12px 30px rgba(2, 6, 23, 0.24)',
} as const

const richSurfaceSx = {
  bgcolor: 'rgba(15, 23, 42, 0.88)',
  border: '1px solid rgba(167, 139, 250, 0.2)',
  borderRadius: '24px',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  boxShadow: '0 16px 40px rgba(2, 6, 23, 0.26)',
} as const

export interface FooterProps {
  /** Layout variant. `signature` is a 1-line strip; `rich` is a multi-column landing footer. */
  variant?: 'signature' | 'rich'
  /** Optional build/version string to display. */
  version?: string
  /** Product tagline shown only on the rich variant. */
  tagline?: string
  /** Override the GitHub link. Defaults to the public dnd-notes repo. */
  githubUrl?: string
  /** Privacy policy href. Defaults to `/privacy`. */
  privacyHref?: string
  /** Terms href. Defaults to `/terms`. */
  termsHref?: string
}

const DEFAULT_GITHUB = 'https://github.com/daydream-software/dnd-notes'
const COPYRIGHT_YEAR = new Date().getFullYear()

function Separator() {
  return (
    <Box component="span" sx={{ color: 'rgba(248, 250, 252, 0.38)', userSelect: 'none' }} aria-hidden="true">
      ·
    </Box>
  )
}

function BrandLockup({ icon, label, productTone = false }: { icon: ReactNode; label: string; productTone?: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        color: productTone ? 'rgba(255, 255, 255, 0.78)' : 'primary.main',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', color: 'primary.main' }}>
        {icon}
      </Box>
      <span>{label}</span>
    </Stack>
  )
}

function SignatureFooter({ version, githubUrl, privacyHref, termsHref }: Required<Pick<FooterProps, 'githubUrl' | 'privacyHref' | 'termsHref'>> & { version?: string }) {
  return (
    <Box
      component="footer"
      sx={{
        mx: 'auto',
        mt: { xs: 5, md: 8 },
        mb: 3,
        maxWidth: 1240,
        px: { xs: 2.5, md: 3.5 },
        py: { xs: 2, md: 2.25 },
        display: 'flex',
        flexWrap: 'wrap',
        gap: { xs: 1.25, md: 2.25 },
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.78)',
        ...sigSurfaceSx,
      }}
    >
      <BrandLockup icon={<DaydreamMark width={18} height={18} />} label="Daydream Software" />
      <Separator />
      <BrandLockup icon={<DndNotesMark width={16} height={16} />} label="D&amp;D Notes" productTone />
      <Separator />
      <Link href={privacyHref} sx={linkSx}>Privacy</Link>
      <Separator />
      <Link href={termsHref} sx={linkSx}>Terms</Link>
      <Separator />
      <Link href={githubUrl} target="_blank" rel="noopener noreferrer" sx={linkSx} aria-label="GitHub repository">
        <GitHubMark width={13} height={13} />
        GitHub
      </Link>
      {version ? (
        <>
          <Separator />
          <Box component="span" sx={{ fontFamily: "'Geist Mono', ui-monospace, monospace", color: 'rgba(248, 250, 252, 0.6)', fontSize: 11 }}>
            {version}
          </Box>
        </>
      ) : null}
      <Separator />
      <Box component="span" sx={{ color: 'rgba(248, 250, 252, 0.6)', fontSize: 11 }}>
        © {COPYRIGHT_YEAR} Daydream Software
      </Box>
    </Box>
  )
}

function RichFooter({
  tagline,
  version,
  githubUrl,
  privacyHref,
  termsHref,
}: Required<Pick<FooterProps, 'githubUrl' | 'privacyHref' | 'termsHref'>> & { tagline?: string; version?: string }) {
  return (
    <Box
      component="footer"
      sx={{
        mx: 'auto',
        mt: { xs: 6, md: 10 },
        mb: 3,
        maxWidth: 1240,
        ...richSurfaceSx,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr 1fr 1fr' },
          gap: { xs: 3.5, md: 4 },
          px: { xs: 3, md: 4 },
          py: { xs: 3.5, md: 4 },
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', color: 'primary.main' }}>
            <DaydreamMark width={36} height={36} />
            <Stack spacing={0}>
              <Typography sx={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.005em', color: 'rgba(255, 255, 255, 0.92)' }}>
                Daydream Software
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: 'rgba(248, 250, 252, 0.6)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Makers of D&amp;D Notes
              </Typography>
            </Stack>
          </Stack>
          {tagline ? (
            <Typography sx={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.78)', maxWidth: 320, lineHeight: 1.55 }}>
              {tagline}
            </Typography>
          ) : null}
        </Stack>

        <Stack spacing={1}>
          <Box component="span" sx={sectionLabelSx}>Product</Box>
          <Link href="/changelog" sx={linkSx}>Changelog</Link>
          <Link href="/status" sx={linkSx}>Status</Link>
          <Link href={githubUrl} target="_blank" rel="noopener noreferrer" sx={linkSx}>
            <GitHubMark width={13} height={13} />
            GitHub
          </Link>
        </Stack>

        <Stack spacing={1}>
          <Box component="span" sx={sectionLabelSx}>Company</Box>
          <Link href="/about" sx={linkSx}>About</Link>
          <Link href="/contact" sx={linkSx}>Contact</Link>
        </Stack>

        <Stack spacing={1}>
          <Box component="span" sx={sectionLabelSx}>Legal</Box>
          <Link href={privacyHref} sx={linkSx}>Privacy</Link>
          <Link href={termsHref} sx={linkSx}>Terms</Link>
        </Stack>
      </Box>

      <Box
        sx={{
          borderTop: '1px solid rgba(167, 139, 250, 0.18)',
          px: { xs: 3, md: 4 },
          py: 2,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'rgba(248, 250, 252, 0.6)',
          fontSize: 11.5,
        }}
      >
        <Box component="span">© {COPYRIGHT_YEAR} Daydream Software. All rights reserved.</Box>
        {version ? (
          <Box component="span" sx={{ fontFamily: "'Geist Mono', ui-monospace, monospace" }}>
            D&amp;D Notes {version}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

/**
 * Footer used across all three Daydream Software frontends.
 *
 * - `signature` (default): a single horizontal pill row — used in the notes
 *   workspace and the operator portal where the footer is incidental.
 * - `rich`: multi-column landing-page footer — used in the customer portal
 *   landing surface.
 */
export function Footer(props: FooterProps) {
  const {
    variant = 'signature',
    version,
    tagline,
    githubUrl = DEFAULT_GITHUB,
    privacyHref = '/privacy',
    termsHref = '/terms',
  } = props

  if (variant === 'rich') {
    return (
      <RichFooter
        tagline={tagline}
        version={version}
        githubUrl={githubUrl}
        privacyHref={privacyHref}
        termsHref={termsHref}
      />
    )
  }

  return (
    <SignatureFooter
      version={version}
      githubUrl={githubUrl}
      privacyHref={privacyHref}
      termsHref={termsHref}
    />
  )
}
