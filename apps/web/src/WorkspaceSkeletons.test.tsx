import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '@dnd-notes/theme'
import {
  NoteBodySkeleton,
  NoteListItemSkeleton,
  WorkspaceHeaderSkeleton,
} from './WorkspaceSkeletons'

function withTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

afterEach(() => {
  cleanup()
})

describe('WorkspaceHeaderSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = withTheme(<WorkspaceHeaderSkeleton />)
    expect(container.firstChild).not.toBeNull()
  })
})

describe('NoteListItemSkeleton', () => {
  it('renders skeleton elements', () => {
    withTheme(<NoteListItemSkeleton />)
    const skeletons = document.querySelectorAll('.MuiSkeleton-root')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders the configured number of rows', () => {
    const { container } = withTheme(<NoteListItemSkeleton count={3} />)
    // The outer Stack has 3 direct Box children (one per row)
    const stack = container.firstChild as HTMLElement
    expect(stack.children).toHaveLength(3)
  })
})

describe('NoteBodySkeleton', () => {
  it('renders without crashing', () => {
    const { container } = withTheme(<NoteBodySkeleton />)
    expect(container.firstChild).not.toBeNull()
  })
})
