import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline } from '@mui/material'
import { ThemeRoot } from '@dnd-notes/theme'
import '@dnd-notes/theme/tokens.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeRoot>
      <CssBaseline />
      <App />
    </ThemeRoot>
  </StrictMode>,
)
