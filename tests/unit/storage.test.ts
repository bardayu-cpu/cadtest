import 'fake-indexeddb/auto';
import { createStore, get, set } from 'idb-keyval';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY, createProjectStore } from '../../src/model/store';
import {
  createProjectStorage,
  PROJECT_INDEX_KEY,
  projectKey,
} from '../../src/model/storage';
import { createProject, exportProjectJson } from '../../src/model/project';
import { completeProject } from '../helpers/project';
import { indexEntry, memoryStorage } from '../helpers/storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe('IndexedDB persistence', () => {
  it('restores a project lazily across stores, updates its index, and persists undo and deletion', async () => {
    const storage = createProjectStorage(`test-${crypto.randomUUID()}`);
    const project = completeProject();
    await storage.save(project, indexEntry(project).updatedAt);
    const first = createProjectStore(storage);
    await first.getState().hydrate();
    expect(first.getState().projects).toEqual([indexEntry(project)]);
    expect(first.getState().currentProject).toBeNull();
    await first.getState().openProject(project.id);
    first.getState().updateWall('wall-1', { thickness: 120 });
    first.getState().updateProject({ name: '新名称' });
    await first.getState().flush();
    const restored = createProjectStore(storage);
    await restored.getState().hydrate();
    expect(restored.getState().projects).toEqual(first.getState().projects);
    await restored.getState().openProject(project.id);
    expect(restored.getState().currentProject).toEqual(
      first.getState().currentProject,
    );
    expect(restored.getState().currentProject!.walls[0].source).toBe('manual');
    first.getState().undo();
    first.getState().undo();
    await first.getState().flush();
    expect(await storage.loadProject(project.id)).toEqual(project);
    first.getState().deleteProject(project.id);
    await first.getState().flush();
    expect(await storage.loadProject(project.id)).toBeUndefined();
    expect(await storage.loadIndex()).toEqual([]);
  });
  it('uses project keys and atomically retains other entries during concurrent saves', async () => {
    const databaseName = `test-${crypto.randomUUID()}`;
    const storage = createProjectStorage(databaseName);
    const one = completeProject(),
      two = completeProject();
    await Promise.all([
      storage.save(one, indexEntry(one).updatedAt),
      storage.save(two, indexEntry(two).updatedAt),
    ]);
    const objects = createStore(databaseName, 'projects');
    expect(await get(projectKey(one.id), objects)).toEqual(one);
    expect(await get(projectKey(two.id), objects)).toEqual(two);
    expect(await storage.loadIndex()).toEqual(
      expect.arrayContaining([indexEntry(one), indexEntry(two)]),
    );
    const changed = { ...one, name: '修改' };
    await storage.save(changed, '2026-10-11T01:00:00Z');
    expect(await storage.loadProject(two.id)).toEqual(two);
    expect(await storage.loadIndex()).toContainEqual({
      id: one.id,
      name: '修改',
      updatedAt: '2026-10-11T01:00:00Z',
    });
    await storage.delete(one.id);
    expect(await storage.loadIndex()).toEqual([indexEntry(two)]);
    expect(await storage.loadProject(two.id)).toEqual(two);
  });
  it('does not migrate or read the old projects-v2 value', async () => {
    const databaseName = `test-${crypto.randomUUID()}`;
    await set(
      'projects-v2',
      [completeProject()],
      createStore(databaseName, 'projects'),
    );
    const storage = createProjectStorage(databaseName);
    expect(await storage.loadIndex()).toBeUndefined();
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    expect(store.getState().projects).toEqual([]);
  });
  it.each([null, { broken: true }])(
    'aborts both record and index writes when the persisted index is corrupt: %j',
    async (corrupt) => {
      const databaseName = `test-${crypto.randomUUID()}`;
      const objects = createStore(databaseName, 'projects');
      await set(PROJECT_INDEX_KEY, corrupt, objects);
      const storage = createProjectStorage(databaseName);
      const project = completeProject();
      await expect(
        storage.save(project, indexEntry(project).updatedAt),
      ).rejects.toThrow();
      expect(await storage.loadProject(project.id)).toBeUndefined();
      expect(await storage.loadIndex()).toEqual(corrupt);
    },
  );
  it('waits for index hydration without reading project records or saving initial state', async () => {
    const pending = deferred<unknown>();
    const project = completeProject();
    const storage = memoryStorage([project]);
    storage.loadIndex.mockImplementation(() => pending.promise);
    const store = createProjectStore(storage);
    const loading = store.getState().hydrate();
    expect(store.getState().hydrate()).toBe(loading);
    expect(() => store.getState().createProject()).toThrow('读取完成');
    pending.resolve([indexEntry(project)]);
    await loading;
    expect(storage.loadProject).not.toHaveBeenCalled();
    expect(await store.getState().flush()).toBe(true);
    expect(storage.save).not.toHaveBeenCalled();
    await store.getState().openProject(project.id);
    expect(storage.loadProject).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(store.getState().currentProject).toEqual(project);
    expect(storage.save).not.toHaveBeenCalled();
  });
  it('debounces edits for 400ms and writes only the latest current project', async () => {
    vi.useFakeTimers();
    const one = completeProject(),
      two = completeProject();
    const storage = memoryStorage([one, two]);
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    await store.getState().openProject(one.id);
    store.getState().updateProject({ name: '修改一' });
    await vi.advanceTimersByTimeAsync(300);
    store.getState().updateProject({ name: '最新修改' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 1);
    expect(storage.save).not.toHaveBeenCalled();
    expect(store.getState().isSaving).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.save.mock.calls[0][0]).toEqual({ ...one, name: '最新修改' });
    expect(await storage.loadProject(two.id)).toEqual(two);
    expect(store.getState().isSaving).toBe(false);
  });
  it('starts saving immediately on flush before the debounce timer expires', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    store.getState().createProject('即时保存');
    const flushed = store.getState().flush();
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(await flushed).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });
  it('serializes in-flight saves and coalesces subsequent edits instead of writing old snapshots', async () => {
    const storage = memoryStorage();
    const blocked = deferred<void>();
    const save = storage.save.getMockImplementation()!;
    storage.save.mockImplementationOnce(async (project, date) => {
      await blocked.promise;
      await save(project, date);
    });
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    const id = store.getState().createProject('第一版');
    const flushing = store.getState().flush();
    store.getState().updateProject({ name: '第二版' });
    store.getState().updateProject({ name: '最后一版' });
    expect(storage.save).toHaveBeenCalledTimes(1);
    blocked.resolve();
    expect(await flushing).toBe(true);
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(await storage.loadProject(id)).toMatchObject({ name: '最后一版' });
  });
  it('preserves dirty projects during switches and close, without mixing their records', async () => {
    const storage = memoryStorage();
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    const first = store.getState().createProject('第一项');
    store.getState().updateProject({ name: '第一项修改' });
    const second = store.getState().createProject('第二项');
    store.getState().updateProject({ name: '第二项修改' });
    await store.getState().openProject(first);
    expect(store.getState().currentProject!.name).toBe('第一项修改');
    expect(store.getState().past).toEqual([]);
    store.getState().closeProject();
    await store.getState().flush();
    expect(await storage.loadProject(first)).toMatchObject({
      name: '第一项修改',
    });
    expect(await storage.loadProject(second)).toMatchObject({
      name: '第二项修改',
    });
  });
  it('keeps edits after a save failure and retries the latest state', async () => {
    const storage = memoryStorage();
    const save = storage.save.getMockImplementation()!;
    storage.save.mockRejectedValueOnce(new Error('QuotaExceededError'));
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    const id = store.getState().createProject('重要项目');
    expect(await store.getState().flush()).toBe(false);
    expect(store.getState().storageError).toContain('自动保存失败');
    expect(store.getState().currentProject!.name).toBe('重要项目');
    store.getState().updateProject({ name: '保留最新修改' });
    storage.save.mockImplementation(save);
    store.getState().retrySave();
    expect(await store.getState().flush()).toBe(true);
    expect(await storage.loadProject(id)).toMatchObject({
      name: '保留最新修改',
    });
    expect(store.getState().storageError).toBeNull();
  });
  it('retries failed deletion instead of resurrecting an autosaved project', async () => {
    const project = completeProject();
    const storage = memoryStorage([project]);
    storage.delete.mockRejectedValueOnce(new Error('blocked'));
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    await store.getState().openProject(project.id);
    store.getState().updateProject({ name: '修改后删除' });
    store.getState().deleteProject(project.id);
    expect(await store.getState().flush()).toBe(false);
    expect(store.getState().currentProject).toBeNull();
    store.getState().retrySave();
    expect(await store.getState().flush()).toBe(true);
    expect(await storage.loadProject(project.id)).toBeUndefined();
    expect(storage.save).not.toHaveBeenCalled();
  });
  it('does not overwrite corrupt index data and permits hydration retry', async () => {
    const project = completeProject();
    const storage = memoryStorage([project]);
    storage.loadIndex.mockResolvedValueOnce({ version: 1 });
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    expect(store.getState().hydration).toBe('error');
    expect(store.getState().storageError).toContain('已有数据未被覆盖');
    expect(() => store.getState().createProject()).toThrow();
    expect(storage.save).not.toHaveBeenCalled();
    await store.getState().hydrate();
    expect(store.getState().projects).toEqual([indexEntry(project)]);
    expect(store.getState().storageError).toBeNull();
  });
  it('reports corrupt project data without saving it and permits reopening', async () => {
    const project = completeProject();
    const storage = memoryStorage([project]);
    storage.loadProject.mockResolvedValueOnce({ version: 1 });
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    await store.getState().openProject(project.id);
    expect(store.getState().projectLoad).toBe('error');
    expect(store.getState().projectError).toContain('已有数据未被覆盖');
    expect(store.getState().currentProject).toBeNull();
    expect(() =>
      store.getState().updateProject({ name: '不能保存' }),
    ).toThrow();
    expect(storage.save).not.toHaveBeenCalled();
    await store.getState().openProject(project.id);
    expect(store.getState().currentProject).toEqual(project);
    expect(store.getState().projectError).toBeNull();
  });
  it('ignores late reads after switching projects or leaving the editor', async () => {
    const one = completeProject(),
      two = createProject('第二项');
    const storage = memoryStorage([one, two]);
    const blocked = deferred<unknown>();
    storage.loadProject.mockImplementationOnce(() => blocked.promise);
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    const opening = store.getState().openProject(one.id);
    await store.getState().openProject(two.id);
    blocked.resolve(one);
    await opening;
    expect(store.getState().currentProject).toEqual(two);
    const nextRead = deferred<unknown>();
    storage.loadProject.mockImplementationOnce(() => nextRead.promise);
    const leaving = store.getState().openProject(one.id);
    store.getState().closeProject();
    nextRead.resolve(one);
    await leaving;
    expect(store.getState().currentProject).toBeNull();
    expect(storage.save).not.toHaveBeenCalled();
  });
  it('keeps imported data when replacing a project whose read is still pending', async () => {
    const project = completeProject();
    const storage = memoryStorage([project]);
    const blocked = deferred<unknown>();
    storage.loadProject.mockImplementationOnce(() => blocked.promise);
    const store = createProjectStore(storage);
    await store.getState().hydrate();
    const opening = store.getState().openProject(project.id);
    const imported = { ...project, name: '导入新版本' };
    expect(
      store.getState().importProject(exportProjectJson(imported), true).success,
    ).toBe(true);
    blocked.resolve(project);
    await opening;
    await store.getState().flush();
    expect(store.getState().currentProject).toEqual(imported);
    expect(await storage.loadProject(project.id)).toEqual(imported);
  });
});

it('reopens the retained latest snapshot if an in-flight save fails during a switch', async () => {
  const one = completeProject(),
    two = completeProject();
  const storage = memoryStorage([one, two]);
  const blocked = deferred<void>();
  storage.save.mockImplementationOnce(async () => {
    await blocked.promise;
    throw new Error('blocked');
  });
  const store = createProjectStore(storage);
  await store.getState().hydrate();
  await store.getState().openProject(one.id);
  store.getState().updateProject({ name: '不可丢失的修改' });
  const saving = store.getState().flush();
  const secondOpening = store.getState().openProject(two.id);
  const opening = store.getState().openProject(one.id);
  blocked.resolve();
  expect(await saving).toBe(false);
  await Promise.all([secondOpening, opening]);
  expect(store.getState().currentProject!.name).toBe('不可丢失的修改');
  expect(store.getState().projectLoad).toBe('ready');
  store.getState().retrySave();
  await store.getState().flush();
});
