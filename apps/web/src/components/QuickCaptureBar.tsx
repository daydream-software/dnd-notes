import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import { Box, Button, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'

export interface QuickCaptureBarProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => Promise<void> | void
  isSubmitting: boolean
}

const CAPTURED_FLASH_DURATION_MS = 1750

export default function QuickCaptureBar({
  value,
  onValueChange,
  onSubmit,
  isSubmitting,
}: QuickCaptureBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [justCaptured, setJustCaptured] = useState(false)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [])

  const canSubmit = value.trim().length > 0

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || isSubmitting) {
      return
    }

    try {
      await onSubmit()
      setJustCaptured(true)
      inputRef.current?.focus()

      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current)
      }

      flashTimeoutRef.current = setTimeout(() => {
        setJustCaptured(false)
        flashTimeoutRef.current = null
      }, CAPTURED_FLASH_DURATION_MS)
    } catch {
      // Error handling is owned by the caller; bar stays ready
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      onValueChange('')
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: '18px',
        background: 'var(--bg-paper-soft)',
        border: '1px solid var(--brand-line)',
        boxShadow: 'var(--shadow-sm)',
        backdropFilter: 'blur(12px)',
        transition: 'border-color 200ms, box-shadow 200ms',
        '&:focus-within': {
          borderColor: 'var(--accent)',
          boxShadow: '0 0 0 3px var(--brand-line), var(--shadow-sm)',
        },
      }}
    >
      <TextField
        inputRef={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Jot a thought, reminder, or scene — Enter saves to the campaign."
        size="small"
        variant="standard"
        slotProps={{
          input: {
            disableUnderline: true,
            startAdornment: (
              <InputAdornment position="start">
                <BoltRoundedIcon
                  sx={{ color: 'var(--accent)', fontSize: 20 }}
                  aria-hidden="true"
                />
              </InputAdornment>
            ),
          },
          htmlInput: {
            'aria-label': 'Quick capture a note',
          },
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          '& .MuiInputBase-input': {
            color: 'var(--fg-1)',
            fontSize: '0.906rem',
            lineHeight: 1.5,
            py: 0.5,
            '&::placeholder': {
              color: 'var(--fg-muted)',
              opacity: 1,
            },
          },
        }}
      />

      {justCaptured ? (
        <Stack
          direction="row"
          spacing={0.5}
          role="status"
          aria-live="polite"
          sx={{ alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          <CheckCircleRoundedIcon sx={{ color: 'var(--success)', fontSize: 14 }} />
          <Typography
            variant="caption"
            sx={{ color: 'var(--success)', fontWeight: 500 }}
          >
            Captured
          </Typography>
        </Stack>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="small"
        disabled={!canSubmit || isSubmitting}
        sx={{ alignSelf: 'center', flexShrink: 0 }}
      >
        {isSubmitting ? 'Capturing…' : 'Capture'}
      </Button>
    </Box>
  )
}
