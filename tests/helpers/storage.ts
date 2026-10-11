import { vi } from 'vitest';
import type { Project, ProjectIndexEntry } from '../../src/model/types';

export function indexEntry(project: Project): ProjectIndexEntry {
  return {
    id: project.id,
    name: project.name,
    updatedAt: '2026-10-11T00:00:00Z',
  };
}

export function memoryStorage(initial: Project[] = []) {
  const records = new Map(initial.map((project) => [project.id, project]));
  const index = new Map(
    initial.map((project) => [project.id, indexEntry(project)]),
  );
  return {
    loadIndex: vi.fn(async (): Promise<unknown> => [...index.values()]),
    loadProject: vi.fn(async (id: string): Promise<unknown> => records.get(id)),
    save: vi.fn(async (project: Project, updatedAt: string) => {
      records.set(project.id, structuredClone(project));
      index.set(project.id, { ...indexEntry(project), updatedAt });
    }),
    delete: vi.fn(async (id: string) => {
      records.delete(id);
      index.delete(id);
    }),
  };
}
