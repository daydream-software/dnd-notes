import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { theme } from '@dnd-notes/theme'
import './index.css'
import App from './App'
import { WakeReconnectingBanner } from './WakeReconnectingBanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
      <WakeReconnectingBanner />
    </ThemeProvider>
  </StrictMode>,
)
