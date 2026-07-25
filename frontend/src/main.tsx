import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { setUnauthorizedHandler } from './api/adminClient'
import { ADMIN_SESSION_KEY } from './api/adminQueries'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient()

// /admin 配下のどこかで 401 が出たらセッション状態を引き直す。authenticated が
// false に反転すると AdminGate がログイン画面に切り替わる -- これが「どこで
// 401 が出てもログインに戻る」機構で、router 側の介入は要らない。
setUnauthorizedHandler(() => {
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
