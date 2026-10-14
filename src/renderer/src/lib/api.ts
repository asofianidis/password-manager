import { queryOptions } from '@tanstack/react-query'

export const api = window.api

export const queries = {
  status: () =>
    queryOptions({
      queryKey: ['vault', 'status'],
      queryFn: () => api.invoke('vault:status'),
      staleTime: 0
    }),
  entries: () =>
    queryOptions({
      queryKey: ['vault', 'entries'],
      queryFn: () => api.invoke('entries:list')
    }),
  /** Contains secrets: dropped from the cache as soon as nothing is showing it. */
  entry: (id: string) =>
    queryOptions({
      queryKey: ['vault', 'entry', id],
      queryFn: () => api.invoke('entries:get', id),
      gcTime: 0,
      staleTime: 0
    }),
  health: () =>
    queryOptions({
      queryKey: ['vault', 'health'],
      queryFn: () => api.invoke('health:report')
    }),
  settings: () =>
    queryOptions({
      queryKey: ['settings'],
      queryFn: () => api.invoke('settings:get')
    }),
  syncStatus: () =>
    queryOptions({
      queryKey: ['sync', 'status'],
      queryFn: () => api.invoke('sync:status'),
      staleTime: 0
    }),
  update: () =>
    queryOptions({
      queryKey: ['update'],
      queryFn: () => api.invoke('update:status'),
      staleTime: Infinity
    })
}
