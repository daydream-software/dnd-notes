# Customer Portal — UI kit

A high-fidelity recreation of `apps/customer-portal` in the `daydream-software/dnd-notes` repo. Open `index.html` for an interactive walkthrough: marketing landing → signup → customer dashboard with tenant list and add-tenant flow.

## Components

- `App.jsx` — view state machine (landing → dashboard) + plans + tenant list
- `PortalAppBar.jsx` — top bar with provisioning chip + sign-out
- `Hero.jsx` — title section with stat chips
- `PlanCard.jsx` — plan tile (name, price, description, feature bullets)
- `SignupForm.jsx` — work email, password, tenant name + slug, plan, payment provider
- `LoginForm.jsx` — email + password restore
- `TenantCard.jsx` — single tenant row with state chip, backup time, app-link, settings
- `AccountCard.jsx` — owner display name, email, billing provider
- `CreateTenantForm.jsx` — add-another-tenant on the dashboard
- `RoadmapList.jsx` — billing / team / analytics placeholder list

## Reused from the main UI kit

- `Primitives.jsx` and `Chrome.jsx` (`Icon`, `Button`, `IconButton`, `Field`, `Input`, `Chip`, `BrandPill`) — symlinked via `<script src>` to `../web/`
- Shared `colors_and_type.css` tokens

## Fidelity caveats

Cosmetic recreation — no real control-plane API calls. Signup/login produce a fake session and seeded tenant list. State chips and slug normalization match the real app; payment-provider options are exactly the three from `App.tsx`.
