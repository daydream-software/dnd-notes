import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Button, Stack, Typography } from '@mui/material'
import { formatTimestamp } from './formatTimestamp'

interface NoteEditorActionsProps {
  canEditWorkspace: boolean
  isCreating: boolean
  isSaving: boolean
  isDeleting: boolean
  selectedNoteUpdatedAt?: string
  onSave: () => void
  onDelete: () => void
}

export default function NoteEditorActions({
  canEditWorkspace,
  isCreating,
  isSaving,
  isDeleting,
  selectedNoteUpdatedAt,
  onSave,
  onDelete,
}: NoteEditorActionsProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
    >
      <Typography color="text.secondary" variant="body2">
        {selectedNoteUpdatedAt && !isCreating
          ? `Last updated ${formatTimestamp(selectedNoteUpdatedAt)}`
          : canEditWorkspace
            ? `New notes are saved straight to the selected campaign.`
            : 'Viewer links can read shared notes but cannot save changes.'}
      </Typography>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          width: { xs: '100%', sm: 'auto' },
          '& > *': {
            width: { xs: '100%', sm: 'auto' },
          },
        }}
      >
        {canEditWorkspace && !isCreating && selectedNoteUpdatedAt ? (
          <Button
            color="error"
            variant="outlined"
            onClick={onDelete}
            disabled={isSaving || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete note'}
          </Button>
        ) : null}
        {canEditWorkspace ? (
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            onClick={onSave}
            disabled={isSaving || isDeleting}
          >
            {isSaving ? 'Saving...' : 'Save note'}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}
