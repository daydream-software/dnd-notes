import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '@dnd-notes/theme'
import LoginPage, { type LoginPageProps } from './LoginPage'

const defaultProps: LoginPageProps = {
  isKeycloakMode: false,
  isRegisterMode: false,
  registerDraft: { displayName: '', email: '', password: '' },
  loginDraft: { email: '', password: '' },
  isSubmittingAuth: false,
  error: null,
  surfaceRadius: 12,
  heroCardRadius: 18,
  onRegisterDraftChange: vi.fn(),
  onLoginDraftChange: vi.fn(),
  onToggleRegisterMode: vi.fn(),
  onSubmit: vi.fn(),
}

function renderLoginPage(overrides: Partial<LoginPageProps> = {}) {
  const props: LoginPageProps = {
    ...defaultProps,
    onRegisterDraftChange: vi.fn(),
    onLoginDraftChange: vi.fn(),
    onToggleRegisterMode: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  }

  render(
    <ThemeProvider theme={theme}>
      <LoginPage {...props} />
    </ThemeProvider>,
  )

  return props
}

afterEach(() => {
  cleanup()
})

describe('LoginPage — local sign-in mode', () => {
  it('renders email and password fields and the sign-in button', () => {
    renderLoginPage()

    // getByLabelText / getByRole throw if not found — that is the presence assertion
    screen.getByLabelText('Email')
    screen.getByLabelText('Password')
    // Use exact-match regex to avoid hitting the toggle "Already have an account? Sign in"
    screen.getByRole('button', { name: /^Sign in$/ })
  })

  it('renders the "Need an account? Create one" toggle button', () => {
    renderLoginPage()

    screen.getByRole('button', { name: 'Need an account? Create one' })
  })

  it('does not render the display name field', () => {
    renderLoginPage()

    expect(screen.queryByLabelText('Owner display name')).toBeNull()
  })
})

describe('LoginPage — local register mode', () => {
  it('renders display name, email, and password fields and the create button', () => {
    renderLoginPage({ isRegisterMode: true })

    screen.getByLabelText('Owner display name')
    screen.getByLabelText('Email')
    screen.getByLabelText('Password')
    screen.getByRole('button', { name: 'Create owner account' })
  })

  it('renders the "Already have an account? Sign in" toggle button', () => {
    renderLoginPage({ isRegisterMode: true })

    screen.getByRole('button', { name: 'Already have an account? Sign in' })
  })
})

describe('LoginPage — keycloak mode', () => {
  it('renders the Continue button and hides email, password, and display name fields', () => {
    renderLoginPage({ isKeycloakMode: true })

    screen.getByRole('button', { name: 'Continue' })
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Owner display name')).toBeNull()
  })

  it('hides the register/sign-in toggle button', () => {
    renderLoginPage({ isKeycloakMode: true })

    expect(
      screen.queryByRole('button', { name: /Need an account|Already have an account/ }),
    ).toBeNull()
  })
})

describe('LoginPage — isSubmittingAuth=true', () => {
  it('disables the submit button and shows "Signing in…" label in local sign-in mode', () => {
    renderLoginPage({ isSubmittingAuth: true })

    const btn = screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('disables the submit button and shows "Creating account…" label in local register mode', () => {
    renderLoginPage({ isRegisterMode: true, isSubmittingAuth: true })

    const btn = screen.getByRole('button', { name: 'Creating account…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('disables the submit button and shows "Signing in…" label in keycloak mode', () => {
    renderLoginPage({ isKeycloakMode: true, isSubmittingAuth: true })

    const btn = screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('LoginPage — error prop', () => {
  it('renders an error alert containing the error text when error is non-null', () => {
    renderLoginPage({ error: 'Invalid credentials' })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Invalid credentials')
  })

  it('does not render an alert when error is null', () => {
    renderLoginPage({ error: null })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('LoginPage — input callbacks', () => {
  it('calls onLoginDraftChange with field and value when typing in email (local sign-in)', () => {
    const { onLoginDraftChange } = renderLoginPage()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dm@table.com' } })

    expect(onLoginDraftChange).toHaveBeenCalledWith('email', 'dm@table.com')
  })

  it('calls onLoginDraftChange with field and value when typing in password (local sign-in)', () => {
    const { onLoginDraftChange } = renderLoginPage()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })

    expect(onLoginDraftChange).toHaveBeenCalledWith('password', 'hunter2')
  })

  it('calls onSubmit when the submit button is clicked (local sign-in)', () => {
    const { onSubmit } = renderLoginPage()

    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('calls onRegisterDraftChange with field and value when typing in email (local register)', () => {
    const { onRegisterDraftChange } = renderLoginPage({ isRegisterMode: true })

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@table.com' } })

    expect(onRegisterDraftChange).toHaveBeenCalledWith('email', 'new@table.com')
  })

  it('calls onRegisterDraftChange with displayName field when typing in display name', () => {
    const { onRegisterDraftChange } = renderLoginPage({ isRegisterMode: true })

    fireEvent.change(screen.getByLabelText('Owner display name'), {
      target: { value: 'Dungeon Master' },
    })

    expect(onRegisterDraftChange).toHaveBeenCalledWith('displayName', 'Dungeon Master')
  })

  it('calls onToggleRegisterMode when the toggle button is clicked in local sign-in mode', () => {
    const { onToggleRegisterMode } = renderLoginPage()

    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }))

    expect(onToggleRegisterMode).toHaveBeenCalledOnce()
  })

  it('calls onToggleRegisterMode when the toggle button is clicked in local register mode', () => {
    const { onToggleRegisterMode } = renderLoginPage({ isRegisterMode: true })

    fireEvent.click(
      screen.getByRole('button', { name: 'Already have an account? Sign in' }),
    )

    expect(onToggleRegisterMode).toHaveBeenCalledOnce()
  })
})
