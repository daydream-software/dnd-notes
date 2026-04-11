import { z } from 'zod'
import { noteStatuses, type NoteInput } from './types.js'

const notePayloadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(120, 'Title must be 120 characters or fewer.'),
  body: z
    .string()
    .trim()
    .min(1, 'Body is required.')
    .max(10_000, 'Body must be 10,000 characters or fewer.'),
  status: z.enum(noteStatuses),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Tags cannot be empty.')
        .max(24, 'Tags must be 24 characters or fewer.'),
    )
    .max(8, 'Use at most 8 tags.')
    .default([])
    .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]),
  sessionName: z
    .union([
      z
        .string()
        .trim()
        .min(1, 'Session name cannot be empty.')
        .max(120, 'Session name must be 120 characters or fewer.'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) {
        return null
      }

      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }),
})

export function validateNoteInput(
  input: unknown,
): { success: true; data: NoteInput } | { success: false; errors: string[] } {
  const result = notePayloadSchema.safeParse(input)

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => issue.message),
    }
  }

  return {
    success: true,
    data: result.data,
  }
}
