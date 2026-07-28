import React from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, lightTheme, darkTheme } from '@rainbow-me/rainbowkit'
import { App } from './App'
import { config } from './wagmi'
import { ThemeProvider, useTheme } from './theme'
import '@rainbow-me/rainbowkit/styles.css'
import './index.css'

const queryClient = new QueryClient()

// Match the RainbowKit modal/connect chrome to the active Exact Ledger theme.
const rkOptions = {
  accentColor: '#B9FF38',
  accentColorForeground: '#181A17',
  borderRadius: 'none' as const,
  fontStack: 'system' as const,
}

function RainbowKit({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  const rkTheme = theme === 'dark' ? darkTheme(rkOptions) : lightTheme(rkOptions)
  return (
    <RainbowKitProvider locale="en" theme={rkTheme}>
      {children}
    </RainbowKitProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RainbowKit>
            <App />
          </RainbowKit>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
