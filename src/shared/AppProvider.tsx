'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { WebMCPBridge } from './WebMCPBridge';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { type AppConfig, type Filters, type User, emptyFilters } from '../contracts/schemas';
import { createGateway, type Gateway } from '../services/gateway';
import { readFilters, toggleComparison } from '../domain/rooms';
import { AppContext as Context } from './app-context';
export { useApp } from './app-context';
export function AppProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const api = useMemo(() => createGateway(config), [config]);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [selected, setSelected] = useState<string[]>([]),
    [user, setUser] = useState<User | null>(null),
    [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    setFilters(readFilters(new URLSearchParams(location.search)));
    const c = new AbortController();
    api
      .me(c.signal)
      .then(setUser)
      .catch((e) => {
        if (!c.signal.aborted) setAuthError(e.message);
      });
    return () => c.abort();
  }, [api]);
  const toggleRoom = (id: string) => {
    try {
      setSelected(toggleComparison(selected, id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Context.Provider
      value={{
        config,
        api,
        filters,
        setFilters,
        selected,
        setSelected,
        toggleRoom,
        user,
        setUser,
        authError,
      }}
    >
      <WebMCPBridge />
      {children}
      <Toaster position="top-center" richColors />
    </Context.Provider>
  );
}
