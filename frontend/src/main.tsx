import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ADMIN_SESSION_KEY } from './api/adminQueries'
import { AUTH_SESSION_KEY } from './api/authQueries'
import { setUnauthorizedHandler } from './api/session'
import App from './App.tsx'
import './index.css'

// 4xx は状態が変わらない限り何度投げても同じ結果なので再試行しない(上流の 401 は
// backend が 502 に写すので、ここに来る 4xx はクライアント側の問題)。5xx とネットワーク
// 断は 1 回だけ再試行する。
function isClientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === "number" && status >= 400 && status < 500
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 同じ検索が複数の部品から続けて呼ばれたり、タブの切り替えで部品が付け直されたり
      // しても、30 秒以内なら引き直さない。フォーカス復帰時の再取得も stale なものだけになる。
      // 書き込み後は各 mutation の invalidate が効くので鮮度は落ちない。
      staleTime: 30 * 1000,
      retry: (failureCount, error) => failureCount < 1 && !isClientError(error),
    },
  },
})

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
