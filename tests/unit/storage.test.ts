import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../src/model/store';
import { createProjectStorage } from '../../src/model/storage';
import type { Project } from '../../src/model/types';
import { completeProject } from '../helpers/project';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('IndexedDB persistence', () => {
  it('restores complete projects across store instances, including undo and deletion', async () => {
    const storage = createProjectStorage(`test-${crypto.randomUUID()}`);
    const project = completeProject();
    await storage.save([project]);
    const first = createProjectStore(storage);
    await first.getState().hydrate();
    expect(first.getState().projects).toEqual([project]);
    first.getState().openProject(project.id);
    first.getState().updateWall('wall-1', { thickness: 120 });
    await first.getState().flush();
    const restored = createProjectStore(storage);
    await restored.getState().hydrate();
    expect(restored.getState().projects).toEqual(first.getState().projects);
    expect(restored.getState().projects[0].walls[0].source).toBe('manual');
    first.getState().undo();
    await first.getState().flush();
    expect(await storage.load()).toEqual([project]);
    first.getState().deleteProject(project.id);
    await first.getState().flush();
    const empty = createProjectStore(storage);
    await empty.getState().hydrate();
    expect(empty.getState().projects).toEqual([]);
  });
  it('waits for hydration and never autosaves the initial empty state', async () => {
    const pending = deferred<unknown>();
    const save = vi.fn(async () => {});
    const store = createProjectStore({ load: () => pending.promise, save });
    const loading = store.getState().hydrate();
    expect(store.getState().hydrate()).toBe(loading);
    expect(() => store.getState().createProject()).toThrow('读取完成');
    const project = completeProject();
    pending.resolve([project]);
    await loading;
    await store.getState().flush();
    expect(store.getState().projects).toEqual([project]);
    expect(save).not.toHaveBeenCalled();
  });
  it('serializes rapid autosaves so earlier writes cannot finish after newer edits', async () => {
    const pending = deferred<void>();
    let saved: Project[] = [];
    let calls = 0;
    const save = vi.fn(async (projects: Project[]) => {
      if (calls++ === 0) await pending.promise;
      saved = structuredClone(projects);
    });
    const store = createProjectStore({ load: async () => undefined, save });
    await store.getState().hydrate();
    store.getState().createProject('初始名称');
    store.getState().updateProject({ name: '修改一' });
    store.getState().updateProject({ name: '最新修改' });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(store.getState().isSaving).toBe(true);
    pending.resolve();
    expect(await store.getState().flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(3);
    expect(saved[0].name).toBe('最新修改');
    expect(store.getState().isSaving).toBe(false);
  });
  it('preserves in-memory edits on save failure and can retry', async () => {
    const save = vi.fn<(projects: Project[]) => Promise<void>>(async () => {
      throw new Error('QuotaExceededError');
    });
    const store = createProjectStore({ load: async () => undefined, save });
    await store.getState().hydrate();
    store.getState().createProject('重要项目');
    expect(await store.getState().flush()).toBe(false);
    expect(store.getState().storageError).toContain('自动保存失败');
    expect(store.getState().projects[0].name).toBe('重要项目');
    save.mockImplementation(async () => {});
    store.getState().retrySave();
    expect(await store.getState().flush()).toBe(true);
    expect(store.getState().storageError).toBeNull();
  });
  it('does not overwrite corrupt stored data and permits a read retry', async () => {
    const load = vi.fn<() => Promise<unknown>>(async () => ({ version: 1 }));
    const save = vi.fn(async () => {});
    const store = createProjectStore({ load, save });
    await store.getState().hydrate();
    expect(store.getState().hydration).toBe('error');
    expect(store.getState().storageError).toContain('已有数据未被覆盖');
    expect(() => store.getState().createProject()).toThrow();
    expect(save).not.toHaveBeenCalled();
    const project = completeProject();
    load.mockResolvedValue([project]);
    await store.getState().hydrate();
    expect(store.getState().projects).toEqual([project]);
    expect(store.getState().storageError).toBeNull();
  });
});
