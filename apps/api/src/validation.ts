import { z } from 'zod'
import {
  noteStatuses,
  type CampaignInput,
  type OwnerLoginInput,
  type OwnerRegistrationInput,
  type NoteInput,
} from './types.js'

const nullableTrimmedString = (field: string, maxLength: number) =>
  z
    .union([
      z
        .string()
        .trim()
        .min(1, `${field} cannot be empty.`)
        .max(maxLength, `${field} must be ${maxLength} characters or fewer.`),
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
    })

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
  sessionName: nullableTrimmedString('Session name', 120),
  campaignId: nullableTrimmedString('Campaign id', 120),
})

const campaignPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Campaign name is required.')
    .max(120, 'Campaign name must be 120 characters or fewer.'),
  tagline: z
    .string()
    .trim()
    .min(1, 'Tagline is required.')
    .max(240, 'Tagline must be 240 characters or fewer.'),
  system: z
    .string()
    .trim()
    .min(1, 'System is required.')
    .max(120, 'System must be 120 characters or fewer.'),
  setting: z
    .string()
    .trim()
    .min(1, 'Setting is required.')
    .max(120, 'Setting must be 120 characters or fewer.'),
  nextSession: nullableTrimmedString('Next session', 120),
})

const ownerRegistrationSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required.')
    .max(80, 'Display name must be 80 characters or fewer.'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Email must be valid.')
    .max(320, 'Email must be 320 characters or fewer.')
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters long.')
    .max(200, 'Password must be 200 characters or fewer.'),
})

const ownerLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Email must be valid.')
    .max(320, 'Email must be 320 characters or fewer.')
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(1, 'Password is required.')
    .max(200, 'Password must be 200 characters or fewer.'),
})

function mapValidationResult<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: z.ZodError<T> },
): { success: true; data: T } | { success: false; errors: string[] } {
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

export function validateNoteInput(
  input: unknown,
): { success: true; data: NoteInput } | { success: false; errors: string[] } {
  return mapValidationResult(notePayloadSchema.safeParse(input))
}

export function validateCampaignInput(
  input: unknown,
):
  | { success: true; data: CampaignInput }
  | { success: false; errors: string[] } {
  return mapValidationResult(campaignPayloadSchema.safeParse(input))
}

export function validateOwnerRegistrationInput(
  input: unknown,
):
  | { success: true; data: OwnerRegistrationInput }
  | { success: false; errors: string[] } {
  return mapValidationResult(ownerRegistrationSchema.safeParse(input))
}

export function validateOwnerLoginInput(
  input: unknown,
):
  | { success: true; data: OwnerLoginInput }
  | { success: false; errors: string[] } {
  return mapValidationResult(ownerLoginSchema.safeParse(input))
}
