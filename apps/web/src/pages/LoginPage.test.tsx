import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '@dnd-notes/theme'
import LoginPage, { type LoginPageProps } from './LoginPage'

const defaultProps: LoginPageProps = {
  isSubmittingAuth: false,
  error: null,
  surfaceRadius: 12,
  heroCardRadius: 18,
  onSubmit: vi.fn(),
}

function renderLoginPage(overrides: Partial<LoginPageProps> = {}) {
  const props: LoginPageProps = {
    ...defaultProps,
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

describe('LoginPage — default state', () => {
  it('renders the Continue button', () => {
    renderLoginPage()

    screen.getByRole('button', { name: 'Continue' })
  })

  it('does not render email, password, or display name fields', () => {
    renderLoginPage()

    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Owner display name')).toBeNull()
  })

  it('does not render register/sign-in toggle button', () => {
    renderLoginPage()

    expect(
      screen.queryByRole('button', { name: /Need an account|Already have an account/ }),
    ).toBeNull()
  })
})

describe('LoginPage — isSubmittingAuth=true', () => {
  it('disables the submit button and shows "Signing in…" label', () => {
    renderLoginPage({ isSubmittingAuth: true })

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

describe('LoginPage — onSubmit callback', () => {
  it('calls onSubmit when the Continue button is clicked', () => {
    const { onSubmit } = renderLoginPage()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
