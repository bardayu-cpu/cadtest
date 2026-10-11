'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { createProjectStore, type ProjectState } from './store';
import { getHistoryShortcut } from './shortcuts';

const ProjectContext = createContext<ReturnType<
  typeof createProjectStore
> | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createProjectStore());
  useEffect(() => {
    void store.getState().hydrate();
    function onKeyDown(event: KeyboardEvent) {
      const editingText =
        event.target instanceof HTMLElement &&
        Boolean(
          event.target.closest(
            'input, textarea, select, [contenteditable="true"]',
          ),
        );
      const action = getHistoryShortcut(event, editingText);
      const state = store.getState();
      if (!action || state.hydration !== 'ready' || !state.activeProjectId)
        return;
      if (
        action === 'undo' ? state.past.length === 0 : state.future.length === 0
      )
        return;
      event.preventDefault();
      state[action]();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);
  return (
    <ProjectContext.Provider value={store}>{children}</ProjectContext.Provider>
  );
}

export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  const store = useContext(ProjectContext);
  if (!store) throw new Error('ProjectProvider is required.');
  return useStore(store, selector);
}
