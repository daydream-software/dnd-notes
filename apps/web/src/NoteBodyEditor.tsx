import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  TRANSFORMERS,
} from '@lexical/markdown'
import { $setBlocksType } from '@lexical/selection'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
} from '@lexical/react/LexicalHorizontalRuleNode'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { CodeNode } from '@lexical/code'
import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from '@lexical/list'
import {
  $createHeadingNode,
  HeadingNode,
  type HeadingTagType,
  QuoteNode,
} from '@lexical/rich-text'
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from 'lexical'
import {
  type MouseEvent,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { markdownSx } from './note-markdown-styles'

type NoteBodyEditorMode = 'editor' | 'source'

interface NoteBodyEditorProps {
  body: string
  onChange: (value: string) => void
  surfaceRadius: string
}

const dividerTransformer: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export(node) {
    return $isHorizontalRuleNode(node) ? '---' : null
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace(parentNode, _children, _match, isImport) {
    const dividerNode = $createHorizontalRuleNode()

    if (isImport || parentNode.getNextSibling() !== null) {
      parentNode.replace(dividerNode)
    } else {
      parentNode.insertBefore(dividerNode)
    }

    if (!isImport) {
      dividerNode.selectNext()
    }
  },
  type: 'element',
}

const markdownTransformers = [dividerTransformer, ...TRANSFORMERS]

function MarkdownSyncPlugin({
  markdown,
  markdownRef,
}: {
  markdown: string
  markdownRef: MutableRefObject<string>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (markdownRef.current === markdown) {
      return
    }

    markdownRef.current = markdown
    editor.update(() => {
      $convertFromMarkdownString(markdown, markdownTransformers)
    })
  }, [editor, markdown, markdownRef])

  return null
}

function FormattingToolbar() {
  const [editor] = useLexicalComposerContext()

  const handleToolbarMouseDown = (event: MouseEvent) => {
    event.preventDefault()
  }

  const handleToggleLink = () => {
    const nextUrl = window.prompt('Enter a link URL. Leave blank to remove the link.', 'https://')

    if (nextUrl === null) {
      return
    }

    const normalizedUrl = nextUrl.trim()
    editor.dispatchCommand(
      TOGGLE_LINK_COMMAND,
      normalizedUrl.length > 0 ? normalizedUrl : null,
    )
  }

  const handleHeading = (tag: HeadingTagType) => {
    editor.update(() => {
      const selection = $getSelection()

      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(tag))
      }
    })
  }

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        flexWrap: { xs: 'nowrap', sm: 'wrap' },
        overflowX: { xs: 'auto', sm: 'visible' },
        overflowY: 'hidden',
        pb: { xs: 0.5, sm: 0 },
        pr: 0.5,
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': {
          height: 6,
        },
        '& > *': {
          flex: '0 0 auto',
        },
      }}
    >
      <Button
        size="small"
        variant="outlined"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => handleHeading('h1')}
      >
        H1
      </Button>
      <Button
        size="small"
        variant="outlined"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => handleHeading('h2')}
      >
        H2
      </Button>
      <Button
        size="small"
        variant="outlined"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => handleHeading('h3')}
      >
        H3
      </Button>
      <IconButton
        aria-label="Bold"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        <FormatBoldRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton
        aria-label="Italic"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        <FormatItalicRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton
        aria-label="Bulleted list"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        <FormatListBulletedRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton
        aria-label="Numbered list"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        <FormatListNumberedRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton
        aria-label="Link"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={handleToggleLink}
      >
        <LinkRoundedIcon fontSize="small" />
      </IconButton>
      <Button
        aria-label="Horizontal rule"
        size="small"
        variant="outlined"
        startIcon={<HorizontalRuleRoundedIcon fontSize="small" />}
        onMouseDown={handleToolbarMouseDown}
        onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}
      >
        Divider
      </Button>
    </Box>
  )
}

export default function NoteBodyEditor({
  body,
  onChange,
  surfaceRadius,
}: NoteBodyEditorProps) {
  const [mode, setMode] = useState<NoteBodyEditorMode>('editor')
  const lastMarkdownRef = useRef(body)
  const initialConfig = useMemo(
    () => ({
      namespace: 'dnd-notes-note-body-editor',
      theme: {},
      onError(error: Error) {
        throw error
      },
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        LinkNode,
        HorizontalRuleNode,
      ],
      editorState() {
        if (body.trim().length > 0) {
          $convertFromMarkdownString(body, markdownTransformers)
        }
      },
    }),
    [body],
  )

  return (
    <Stack spacing={1.25} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          justifyContent: 'space-between',
          alignItems: { sm: 'center' },
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1">Body</Typography>
          <Typography color="text.secondary" variant="body2">
            {mode === 'editor'
              ? 'Editor mode lets you work with headings, lists, links, and dividers without Markdown syntax.'
              : 'Source mode edits the raw Markdown directly, including headings (#) and dividers (---).'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: 0 }}>
          <Button
            size="small"
            variant={mode === 'editor' ? 'contained' : 'outlined'}
            fullWidth
            sx={{ flex: 1, minWidth: 0 }}
            onClick={() => setMode('editor')}
          >
            Editor
          </Button>
          <Button
            size="small"
            variant={mode === 'source' ? 'contained' : 'outlined'}
            fullWidth
            sx={{ flex: 1, minWidth: 0 }}
            onClick={() => setMode('source')}
          >
            Source
          </Button>
        </Stack>
      </Stack>

      {mode === 'source' ? (
        <TextField
          fullWidth
          label="Body"
          multiline
          minRows={8}
          value={body}
          onChange={(event) => {
            lastMarkdownRef.current = event.target.value
            onChange(event.target.value)
          }}
          helperText="Edit the raw Markdown directly, including headings (#), dividers (---), lists, links, and emphasis."
          sx={{
            width: '100%',
            '& .MuiInputBase-inputMultiline': {
              minHeight: { xs: '10rem !important', sm: '15rem !important' },
            },
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: surfaceRadius,
            p: { xs: 1.25, sm: 2 },
          }}
        >
          <LexicalComposer initialConfig={initialConfig}>
            <Stack spacing={1.25} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
              <FormattingToolbar />
              <Box
                sx={{
                  ...markdownSx,
                  position: 'relative',
                  width: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  '& .note-body-editor__input': {
                    minHeight: { xs: 180, sm: 240 },
                    maxWidth: '100%',
                    minWidth: 0,
                    outline: 'none',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  },
                  '& .note-body-editor__placeholder': {
                    color: 'text.secondary',
                    left: 0,
                    pointerEvents: 'none',
                    position: 'absolute',
                    top: 0,
                  },
                }}
              >
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      aria-label="Body editor"
                      className="note-body-editor__input"
                    />
                  }
                  placeholder={
                    <Typography className="note-body-editor__placeholder" variant="body2">
                      Start writing the note body...
                    </Typography>
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
                <HorizontalRulePlugin />
                <ListPlugin />
                <LinkPlugin />
                <MarkdownShortcutPlugin transformers={markdownTransformers} />
                <MarkdownSyncPlugin markdown={body} markdownRef={lastMarkdownRef} />
                <OnChangePlugin
                  ignoreSelectionChange
                  onChange={(editorState) => {
                    editorState.read(() => {
                      const nextMarkdown = $convertToMarkdownString(markdownTransformers)

                      if (nextMarkdown === lastMarkdownRef.current) {
                        return
                      }

                      lastMarkdownRef.current = nextMarkdown
                      onChange(nextMarkdown)
                    })
                  }}
                />
              </Box>
            </Stack>
          </LexicalComposer>
        </Box>
      )}
    </Stack>
  )
}
