import { createStore, get, set } from 'idb-keyval';
import type { Project } from './types';

export interface ProjectStorage {
  load(): Promise<unknown>;
  save(projects: Project[]): Promise<void>;
}

export function createProjectStorage(databaseName = 'cadtest'): ProjectStorage {
  // createStore opens IndexedDB lazily, so importing this module is SSR-safe.
  const database = createStore(databaseName, 'projects');
  return {
    load: () => get<unknown>('projects-v2', database),
    save: (projects) => set('projects-v2', projects, database),
  };
}
