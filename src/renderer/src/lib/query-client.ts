import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data comes from the local main process, not the network
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})
