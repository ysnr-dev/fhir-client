import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ADMIN_SESSION_KEY } from './api/adminQueries'
import { AUTH_SESSION_KEY } from './api/authQueries'
import { setUnauthorizedHandler } from './api/session'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient()

// どこかの API で 401 が出たらセッション状態を引き直す。authenticated が
// false に反転すると AuthGate / AdminGate がログイン画面に切り替わる -- これが
// 「どこで 401 が出てもログインに戻る」機構で、router 側の介入は要らない。
setUnauthorizedHandler(() => {
  queryClient.invalidateQueries({ queryKey: AUTH_SESSION_KEY })
  queryClient.invalidateQueries({ queryKey: ADMIN_SESSION_KEY })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
