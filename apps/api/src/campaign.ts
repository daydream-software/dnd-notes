import type { CampaignInput } from './types.js'

export const defaultCampaignId = 'moonshae-ledger'
export const defaultOwnerDisplayName = 'Campaign owner'

export const defaultCampaign: CampaignInput & { id: string } = {
  id: defaultCampaignId,
  name: 'Moonshae Ledger',
  tagline:
    'Capture the clues, fallout, and character beats that matter between sessions.',
  system: 'Dungeons & Dragons 5e',
  setting: 'Moonshae Isles',
  nextSession: '2026-04-18T19:00:00.000Z',
}
