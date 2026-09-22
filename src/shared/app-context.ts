'use client';
import { createContext, useContext } from 'react';
import type { AppConfig, Filters, User } from '../contracts/schemas';
import type { Gateway } from '../services/gateway';
export type AppState = {
  config: AppConfig;
  api: Gateway;
  filters: Filters;
  setFilters: (f: Filters) => void;
  selected: string[];
  setSelected: (v: string[]) => void;
  toggleRoom: (id: string) => void;
  user: User | null;
  setUser: (u: User | null) => void;
  authError: string | null;
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppProvider required');
  return value;
}
