import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { cardBorderColor } from '@dnd-notes/theme'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  type TextMatchTransformer,
  TRANSFORMERS,
} from '@lexical/markdown'
import { $setBlocksType } from '@lexical/selection'
import { $findMatchingParent } from '@lexical/utils'
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
import { $createLinkNode, $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
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
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import {
  type MouseEvent,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { markdownSx } from './note-markdown-styles'
import {
  createInternalNoteReferenceHref,
  formatInlineNoteReference,
  getInlineNoteReferenceDisplayText,
  inlineNoteReferencesToMarkdownLinks,
  markdownLinksToInlineNoteReferences,
  parseInlineNoteReferenceText,
} from './note-references'

type NoteBodyEditorMode = 'editor' | 'source'

export interface NoteLinkOption {
  id: string
  title: string
}

interface NoteBodyEditorProps {
  body: string
  onChange: (value: string) => void
  surfaceRadius: string
  noteOptions?: readonly NoteLinkOption[]
}

interface SourceAutocompleteState {
  query: string
  replaceStart: number
  replaceEnd: number
}

const sourceAutocompleteBoundaryPattern = /(?:^|[\s([{>])!(?:\[\[)?([^\]\n|]*)$/

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

const noteReferenceTransformer: TextMatchTransformer = {
  dependencies: [LinkNode],
  regExp: /!\[\[([^\]\n]+?)\]\]$/,
  replace(textNode, match) {
    if ($findMatchingParent(textNode, $isLinkNode)) {
      return
    }

    const reference = parseInlineNoteReferenceText(match[1])

    if (!reference) {
      return
    }

    const linkNode = $createLinkNode(createInternalNoteReferenceHref(reference.noteId), {
      title: reference.qualifier ?? undefined,
    })
    const linkTextNode = $createTextNode(getInlineNoteReferenceDisplayText(reference))

    linkTextNode.setFormat(textNode.getFormat())
    linkNode.append(linkTextNode)
    textNode.replace(linkNode)

    return linkTextNode
  },
  trigger: ']',
  type: 'text-match',
}

const markdownTransformers = [dividerTransformer, noteReferenceTransformer, ...TRANSFORMERS]
const compactToolbarButtonSx = {
  minWidth: 0,
  px: 1,
  py: 0.375,
  borderRadius: 999,
  fontSize: '0.75rem',
  fontWeight: 600,
  lineHeight: 1.1,
  textTransform: 'none',
}

function normalizeReferenceText(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function createNoteReferenceMarkdown(
  note: NoteLinkOption,
  labelText: string,
  qualifierText: string,
) {
  return formatInlineNoteReference({
    noteId: note.id,
    label: normalizeReferenceText(labelText) ?? note.title,
    qualifier: normalizeReferenceText(qualifierText),
  })
}

function filterNoteLinkOptions(noteOptions: readonly NoteLinkOption[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return noteOptions.slice(0, 8)
  }

  return noteOptions
    .filter((note) => {
      const normalizedTitle = note.title.toLowerCase()
      const normalizedId = note.id.toLowerCase()

      return (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedId.includes(normalizedQuery)
      )
    })
    .slice(0, 8)
}

function getSourceAutocompleteState(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): SourceAutocompleteState | null {
  if (selectionStart !== selectionEnd) {
    return null
  }

  const beforeCursor = markdown.slice(0, selectionStart)
  const match = beforeCursor.match(sourceAutocompleteBoundaryPattern)

  if (!match || match.index === undefined) {
    return null
  }

  const replaceStart = match.index + match[0].lastIndexOf('!')

  return {
    query: match[1]?.trimStart() ?? '',
    replaceStart,
    replaceEnd: selectionStart,
  }
}

function insertTextAtRange(text: string, start: number, end: number, insertion: string) {
  return `${text.slice(0, start)}${insertion}${text.slice(end)}`
}

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
      $convertFromMarkdownString(
        inlineNoteReferencesToMarkdownLinks(markdown),
        markdownTransformers,
      )
    })
  }, [editor, markdown, markdownRef])

  return null
}

function EditorInstancePlugin({
  editorRef,
}: {
  editorRef: MutableRefObject<LexicalEditor | null>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editorRef.current = editor

    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null
      }
    }
  }, [editor, editorRef])

  return null
}

function NoteLinkResults({
  noteOptions,
  onSelect,
  ariaLabel,
  emptyMessage,
}: {
  noteOptions: readonly NoteLinkOption[]
  onSelect: (note: NoteLinkOption) => void
  ariaLabel: string
  emptyMessage: string
}) {
  if (noteOptions.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        {emptyMessage}
      </Typography>
    )
  }

  return (
    <List aria-label={ariaLabel} dense disablePadding>
      {noteOptions.map((note) => (
        <ListItemButton key={note.id} onClick={() => onSelect(note)}>
          <ListItemText primary={note.title} secondary={note.id} />
        </ListItemButton>
      ))}
    </List>
  )
}

function FormattingToolbar({
  onInsertNoteLink,
  isNoteLinkDisabled,
}: {
  onInsertNoteLink: () => void
  isNoteLinkDisabled: boolean
}) {
  const [editor] = useLexicalComposerContext()

  const handleToolbarMouseDown = (event: MouseEvent) => {
    event.preventDefault()
  }

  const handleToggleLink = () => {
    const nextUrl = window.prompt(
      'Enter a link URL. Leave blank to remove the link.',
      'https://',
    )

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
        sx={compactToolbarButtonSx}
        onMouseDown={handleToolbarMouseDown}
        onClick={() => handleHeading('h1')}
      >
        H1
      </Button>
      <Button
        size="small"
        variant="outlined"
        sx={compactToolbarButtonSx}
        onMouseDown={handleToolbarMouseDown}
        onClick={() => handleHeading('h2')}
      >
        H2
      </Button>
      <Button
        size="small"
        variant="outlined"
        sx={compactToolbarButtonSx}
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
        aria-label="External link"
        size="small"
        onMouseDown={handleToolbarMouseDown}
        onClick={handleToggleLink}
      >
        <LinkRoundedIcon fontSize="small" />
      </IconButton>
      <Button
        aria-label="Note link"
        size="small"
        variant="outlined"
        sx={compactToolbarButtonSx}
        onMouseDown={handleToolbarMouseDown}
        onClick={onInsertNoteLink}
        disabled={isNoteLinkDisabled}
      >
        Note
      </Button>
      <Button
        aria-label="Horizontal rule"
        size="small"
        variant="outlined"
        sx={compactToolbarButtonSx}
        onMouseDown={handleToolbarMouseDown}
        onClick={() =>
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        }
      >
        Rule
      </Button>
    </Box>
  )
}

export default function NoteBodyEditor({
  body,
  onChange,
  surfaceRadius,
  noteOptions = [],
}: NoteBodyEditorProps) {
  const [mode, setMode] = useState<NoteBodyEditorMode>('editor')
  const [isNoteLinkPickerOpen, setIsNoteLinkPickerOpen] = useState(false)
  const [noteLinkSearchText, setNoteLinkSearchText] = useState('')
  const [selectedNoteLinkId, setSelectedNoteLinkId] = useState<string | null>(null)
  const [noteLinkLabelText, setNoteLinkLabelText] = useState('')
  const [noteLinkQualifierText, setNoteLinkQualifierText] = useState('')
  const [sourceAutocomplete, setSourceAutocomplete] =
    useState<SourceAutocompleteState | null>(null)
  const lastMarkdownRef = useRef(body)
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceSelectionRef = useRef({ start: body.length, end: body.length })
  const editorRef = useRef<LexicalEditor | null>(null)
  const editorSelectionRef = useRef<BaseSelection | null>(null)
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
          $convertFromMarkdownString(
            inlineNoteReferencesToMarkdownLinks(body),
            markdownTransformers,
          )
        }
      },
    }),
    [body],
  )

  const filteredDialogNoteOptions = useMemo(
    () => filterNoteLinkOptions(noteOptions, noteLinkSearchText),
    [noteLinkSearchText, noteOptions],
  )
  const filteredSourceNoteOptions = useMemo(
    () =>
      sourceAutocomplete
        ? filterNoteLinkOptions(noteOptions, sourceAutocomplete.query)
        : [],
    [noteOptions, sourceAutocomplete],
  )
  const selectedNoteLink = useMemo(
    () =>
      noteOptions.find((noteOption) => noteOption.id === selectedNoteLinkId) ?? null,
    [noteOptions, selectedNoteLinkId],
  )

  const syncSourceAutocomplete = (
    textarea: HTMLTextAreaElement | null,
    nextBody?: string,
  ) => {
    if (!textarea) {
      return
    }

    const resolvedBody = nextBody ?? textarea.value
    const selectionStart = textarea.selectionStart ?? resolvedBody.length
    const selectionEnd = textarea.selectionEnd ?? resolvedBody.length

    sourceSelectionRef.current = {
      start: selectionStart,
      end: selectionEnd,
    }
    setSourceAutocomplete(
      getSourceAutocompleteState(resolvedBody, selectionStart, selectionEnd),
    )
  }

  const openNoteLinkPicker = () => {
    if (mode === 'editor' && editorRef.current) {
      editorRef.current.getEditorState().read(() => {
        const selection = $getSelection()
        editorSelectionRef.current = selection ? selection.clone() : null
      })
    }

    setIsNoteLinkPickerOpen(true)
    setNoteLinkSearchText('')
    setSelectedNoteLinkId(null)
    setNoteLinkLabelText('')
    setNoteLinkQualifierText('')
  }

  const handleDialogNoteSelection = (note: NoteLinkOption) => {
    setSelectedNoteLinkId(note.id)
    setNoteLinkLabelText(note.title)
  }

  const closeNoteLinkPicker = () => {
    setIsNoteLinkPickerOpen(false)
  }

  const insertNoteLinkIntoSource = (
    note: NoteLinkOption,
    labelText: string,
    qualifierText: string,
    start: number,
    end: number,
  ) => {
    const insertion = createNoteReferenceMarkdown(note, labelText, qualifierText)
    const nextBody = insertTextAtRange(body, start, end, insertion)

    lastMarkdownRef.current = nextBody
    onChange(nextBody)

    requestAnimationFrame(() => {
      const textarea = sourceInputRef.current

      if (!textarea) {
        return
      }

      const nextCaretPosition = start + insertion.length
      textarea.focus()
      textarea.setSelectionRange(nextCaretPosition, nextCaretPosition)
      syncSourceAutocomplete(textarea, nextBody)
    })
  }

  const insertNoteLinkIntoEditor = (
    note: NoteLinkOption,
    labelText: string,
    qualifierText: string,
  ) => {
    const editor = editorRef.current
    const insertion = createNoteReferenceMarkdown(note, labelText, qualifierText)

    if (!editor) {
      return
    }

    let nextMarkdown: string | null = null

    editor.update(() => {
      if (editorSelectionRef.current) {
        $setSelection(editorSelectionRef.current)
      }

      let selection = $getSelection()

      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }

      if (!$isRangeSelection(selection)) {
        return
      }

      const linkNode = $createLinkNode(createInternalNoteReferenceHref(note.id), {
        title: normalizeReferenceText(qualifierText) ?? undefined,
      })
      const linkTextNode = $createTextNode(
        normalizeReferenceText(labelText) ?? note.title,
      )

      linkNode.append(linkTextNode)
      selection.insertNodes([linkNode])

      nextMarkdown = markdownLinksToInlineNoteReferences(
        $convertToMarkdownString(markdownTransformers),
      )
      $setSelection(null)
    })

    const resolvedMarkdown =
      nextMarkdown === null || nextMarkdown === lastMarkdownRef.current
        ? `${lastMarkdownRef.current}${/\s$/.test(lastMarkdownRef.current) || lastMarkdownRef.current.length === 0 ? '' : ' '}${insertion}`
        : nextMarkdown

    if (resolvedMarkdown !== lastMarkdownRef.current) {
      lastMarkdownRef.current = resolvedMarkdown
      onChange(resolvedMarkdown)
    }

    editorSelectionRef.current = null
  }

  const handleInsertNoteLink = () => {
    if (!selectedNoteLink) {
      return
    }

    if (mode === 'source') {
      insertNoteLinkIntoSource(
        selectedNoteLink,
        noteLinkLabelText,
        noteLinkQualifierText,
        sourceSelectionRef.current.start,
        sourceSelectionRef.current.end,
      )
    } else {
      insertNoteLinkIntoEditor(
        selectedNoteLink,
        noteLinkLabelText,
        noteLinkQualifierText,
      )
    }

    closeNoteLinkPicker()
  }

  const handleSourceAutocompleteSelection = (note: NoteLinkOption) => {
    if (!sourceAutocomplete) {
      return
    }

    insertNoteLinkIntoSource(
      note,
      note.title,
      '',
      sourceAutocomplete.replaceStart,
      sourceAutocomplete.replaceEnd,
    )
    setSourceAutocomplete(null)
  }

  return (
    <>
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
                ? 'Editor mode lets you work with headings, lists, links, dividers, and inline note references without Markdown syntax.'
                : 'Source mode edits the raw Markdown directly, including headings (#), dividers (---), and note references like ![[noteId|label|qualifier]]. Type ! to search notes.'}
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              width: { xs: '100%', sm: 'auto' },
              minWidth: { xs: 0, sm: 'fit-content' },
              flexShrink: 0,
            }}
          >
            <Button
              size="small"
              variant={mode === 'editor' ? 'contained' : 'outlined'}
              sx={{
                minWidth: 88,
                px: 1.5,
                flexShrink: 0,
              }}
              onClick={() => setMode('editor')}
            >
              Editor
            </Button>
            <Button
              size="small"
              variant={mode === 'source' ? 'contained' : 'outlined'}
              sx={{
                minWidth: 88,
                px: 1.5,
                flexShrink: 0,
              }}
              onClick={() => setMode('source')}
            >
              Source
            </Button>
          </Stack>
        </Stack>

        {mode === 'source' ? (
          <Stack spacing={1}>
            <TextField
              fullWidth
              label="Body"
              multiline
              minRows={8}
              value={body}
              inputRef={(element) => {
                sourceInputRef.current = element
              }}
              onChange={(event) => {
                const nextBody = event.target.value

                lastMarkdownRef.current = nextBody
                onChange(nextBody)
                syncSourceAutocomplete(sourceInputRef.current, nextBody)
              }}
              onClick={() => {
                syncSourceAutocomplete(sourceInputRef.current)
              }}
              onKeyUp={() => {
                syncSourceAutocomplete(sourceInputRef.current)
              }}
              onSelect={() => {
                syncSourceAutocomplete(sourceInputRef.current)
              }}
              helperText="Edit the raw Markdown directly, including headings (#), dividers (---), lists, links, emphasis, and note references like ![[noteId|label|qualifier]]. Type ! to search notes."
              sx={{
                width: '100%',
                '& .MuiInputBase-inputMultiline': {
                  minHeight: { xs: '10rem !important', sm: '15rem !important' },
                },
              }}
            />

            {sourceAutocomplete ? (
              <Paper
                variant="outlined"
                sx={{ p: 1.5, borderRadius: surfaceRadius }}
              >
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Insert a note reference for "{sourceAutocomplete.query || '!'}"
                  </Typography>
                  <NoteLinkResults
                    noteOptions={filteredSourceNoteOptions}
                    onSelect={handleSourceAutocompleteSelection}
                    ariaLabel="Inline note reference suggestions"
                    emptyMessage="No notes match that source-mode search."
                  />
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        ) : (
          <Box
            sx={{
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              border: '1px solid',
              borderColor: cardBorderColor,
              borderRadius: surfaceRadius,
              p: { xs: 1.25, sm: 2 },
            }}
          >
            <LexicalComposer initialConfig={initialConfig}>
              <Stack spacing={1.25} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
                <EditorInstancePlugin editorRef={editorRef} />
                <FormattingToolbar
                  onInsertNoteLink={openNoteLinkPicker}
                  isNoteLinkDisabled={noteOptions.length === 0}
                />
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
                    '& .note-body-editor__input a': {
                      wordBreak: 'break-word',
                    },
                    '& .note-body-editor__input a[href^="/__dnd_note_ref__/"]': {
                      alignItems: 'center',
                      backgroundColor: 'action.selected',
                      border: '1px solid',
                      borderColor: cardBorderColor,
                      borderRadius: 999,
                      color: 'text.primary',
                      display: 'inline-flex',
                      fontWeight: 500,
                      paddingInline: 0.75,
                      textDecoration: 'none',
                    },
                    '& .note-body-editor__input a[href^="/__dnd_note_ref__/"]:hover': {
                      backgroundColor: 'action.hover',
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
                        Start writing the note body…
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
                        const nextMarkdown = markdownLinksToInlineNoteReferences(
                          $convertToMarkdownString(markdownTransformers),
                        )

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

      <Dialog
        open={isNoteLinkPickerOpen}
        onClose={closeNoteLinkPicker}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Insert note link</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Search notes"
              value={noteLinkSearchText}
              onChange={(event) => setNoteLinkSearchText(event.target.value)}
              autoFocus
            />
            <Paper variant="outlined" sx={{ maxHeight: 240, overflowY: 'auto' }}>
              <NoteLinkResults
                noteOptions={filteredDialogNoteOptions}
                onSelect={handleDialogNoteSelection}
                ariaLabel="Note link search results"
                emptyMessage="No notes match that search."
              />
            </Paper>

            {selectedNoteLink ? (
              <>
                <TextField
                  label="Label"
                  value={noteLinkLabelText}
                  onChange={(event) => setNoteLinkLabelText(event.target.value)}
                  helperText="Shown inline in the note. Leave it as the note title or customize it."
                />
                <TextField
                  label="Qualifier"
                  value={noteLinkQualifierText}
                  onChange={(event) => setNoteLinkQualifierText(event.target.value)}
                  helperText="Optional extra context, such as npc, clue, or location."
                />
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeNoteLinkPicker}>Cancel</Button>
          <Button
            onClick={handleInsertNoteLink}
            variant="contained"
            disabled={!selectedNoteLink}
          >
            Insert reference
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
