import { createStore, get, promisifyRequest } from 'idb-keyval';
import { projectIndexSchema, projectSchema } from './schema';
import type { Project, ProjectIndexEntry } from './types';

export const PROJECT_INDEX_KEY = 'project-index-v2';
export const projectKey = (id: string) => `project:${id}`;

export interface ProjectStorage {
  loadIndex(): Promise<unknown>;
  loadProject(id: string): Promise<unknown>;
  save(project: Project, updatedAt: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createProjectStorage(databaseName = 'cadtest'): ProjectStorage {
  // createStore opens IndexedDB lazily, so importing this module is SSR-safe.
  const database = createStore(databaseName, 'projects');
  function mutate(id: string, project?: Project, updatedAt?: string) {
    return database('readwrite', (objects) => {
      // Read and update the index in the same transaction as the project record.
      // This also prevents simultaneous writes of different projects losing entries.
      const completion = promisifyRequest(objects.transaction);
      const request = objects.get(PROJECT_INDEX_KEY);
      request.onsuccess = () => {
        try {
          const index = projectIndexSchema.parse(
            request.result === undefined ? [] : request.result,
          );
          const next = index.filter((entry) => entry.id !== id);
          if (project) {
            const entry: ProjectIndexEntry = {
              id,
              name: project.name,
              updatedAt: updatedAt!,
            };
            next.push(entry);
            objects.put(project, projectKey(id));
          } else objects.delete(projectKey(id));
          objects.put(projectIndexSchema.parse(next), PROJECT_INDEX_KEY);
        } catch {
          objects.transaction.abort();
        }
      };
      return completion;
    });
  }
  return {
    loadIndex: () => get<unknown>(PROJECT_INDEX_KEY, database),
    loadProject: (id) => get<unknown>(projectKey(id), database),
    save: (project, updatedAt) =>
      mutate(project.id, projectSchema.parse(project), updatedAt),
    delete: (id) => mutate(id),
  };
}
