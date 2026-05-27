import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import DebugErrorOverlay from './DebugErrorOverlay.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DebugErrorOverlay>
      <App />
    </DebugErrorOverlay>
  </StrictMode>,
)
