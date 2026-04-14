import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'

interface QuickCaptureProps {
  isOpen: boolean
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  isSubmitting: boolean
}

interface NotesBrowsePaneProps {
  heading: string
  description: string
  actions: ReactNode
  searchText: string
  onSearchTextChange: (value: string) => void
  onClearSearch: () => void
  selectedTagLabel?: string | null
  onClearTagFilter?: () => void
  quickCapture?: QuickCaptureProps
  tagFilters: ReactNode
  children: ReactNode
  surfaceRadius: string
  cardContentSx?: SxProps<Theme>
  contentSpacing?: number
}

function NotesBrowsePane({
  heading,
  description,
  actions,
  searchText,
  onSearchTextChange,
  onClearSearch,
  selectedTagLabel,
  onClearTagFilter,
  quickCapture,
  tagFilters,
  children,
  surfaceRadius,
  cardContentSx,
  contentSpacing = 2,
}: NotesBrowsePaneProps) {
  const resolvedCardContentSx: SxProps<Theme> = [
    { p: { xs: 2, sm: 2.5 }, minWidth: 0 },
    ...(Array.isArray(cardContentSx)
      ? cardContentSx
      : cardContentSx
        ? [cardContentSx]
        : []),
  ]

  return (
    <Card sx={{ borderRadius: surfaceRadius, minWidth: 0 }}>
      <CardContent sx={resolvedCardContentSx}>
        <Stack spacing={contentSpacing} sx={{ minWidth: 0 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6">{heading}</Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>
                {description}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {actions}
            </Stack>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <TextField
              label="Search notes"
              placeholder="Search title, body, tags, session, or collaborator…"
              size="small"
              value={searchText}
              onChange={(event) => onSearchTextChange(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon />
                    </InputAdornment>
                  ),
                  endAdornment: searchText ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={onClearSearch}
                        edge="end"
                        aria-label="Clear search"
                      >
                        <ClearRoundedIcon />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                },
              }}
              sx={{ flex: 1 }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
            >
              <Typography color="text.secondary" variant="body2">
                Tags
              </Typography>
              {selectedTagLabel ? (
                <>
                  <Chip label={selectedTagLabel} color="primary" size="small" />
                  {onClearTagFilter ? (
                    <Button size="small" variant="text" onClick={onClearTagFilter}>
                      Clear filter
                    </Button>
                  ) : null}
                </>
              ) : null}
            </Stack>
          </Stack>

          {quickCapture ? (
            <Collapse in={quickCapture.isOpen}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                component="form"
                onSubmit={(event) => {
                  event.preventDefault()
                  quickCapture.onSubmit()
                }}
              >
                <TextField
                  label="Quick capture"
                  placeholder="Jot down a clue, reminder, or scene…"
                  size="small"
                  value={quickCapture.value}
                  onChange={(event) => quickCapture.onValueChange(event.target.value)}
                  disabled={quickCapture.isSubmitting}
                  sx={{ flex: 1 }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<BoltRoundedIcon />}
                  disabled={!quickCapture.value.trim() || quickCapture.isSubmitting}
                >
                  {quickCapture.isSubmitting ? 'Capturing…' : 'Capture'}
                </Button>
              </Stack>
            </Collapse>
          ) : null}

          {tagFilters}
          {children}
        </Stack>
      </CardContent>
    </Card>
  )
}

export default NotesBrowsePane