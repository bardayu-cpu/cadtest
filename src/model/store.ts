import { createStore } from 'zustand/vanilla';
import { createProject, parseProjectJson, type ImportResult } from './project';
import { projectSchema, projectIndexSchema } from './schema';
import { createProjectStorage, type ProjectStorage } from './storage';
import type {
  Anchor,
  FurnitureItem,
  Opening,
  Project,
  ProjectIndexEntry,
  Room,
  Wall,
} from './types';

export const HISTORY_LIMIT = 100;
export const AUTOSAVE_DELAY = 400;
type Write = { project: Project; updatedAt: string } | { deleted: true };
type Collection = 'walls' | 'openings' | 'rooms' | 'furniture' | 'anchors';
type Entity = Wall | Opening | Room | FurnitureItem | Anchor;
type Patch<T> = Partial<Omit<T, 'id' | 'source'>>;

export interface ProjectState {
  projects: ProjectIndexEntry[];
  currentProject: Project | null;
  projectLoad: 'idle' | 'loading' | 'ready' | 'error';
  projectError: string | null;
  activeProjectId: string | null;
  transactionActive: boolean;
  beginTransaction(): void;
  endTransaction(): void;
  cancelTransaction(): void;
  past: Project[];
  future: Project[];
  hydration: 'idle' | 'loading' | 'ready' | 'error';
  isSaving: boolean;
  storageError: string | null;
  hydrate(): Promise<void>;
  flush(): Promise<boolean>;
  retrySave(): void;
  createProject(name?: string): string;
  deleteProject(id: string): void;
  readProject(id: string): Promise<Project>;
  openProject(id: string): Promise<void>;
  closeProject(): void;
  updateProject(patch: Partial<Omit<Project, 'id' | 'version'>>): void;
  updateBackground(patch: Partial<Project['background']>): void;
  importProject(text: string, overwrite?: boolean): ImportResult;
  addWall(wall: Wall): void;
  updateWall(id: string, patch: Patch<Wall>): void;
  removeWall(id: string): void;
  addOpening(opening: Opening): void;
  updateOpening(id: string, patch: Patch<Opening>): void;
  removeOpening(id: string): void;
  addRoom(room: Room): void;
  updateRoom(id: string, patch: Patch<Room>): void;
  removeRoom(id: string): void;
  addFurniture(item: FurnitureItem): void;
  updateFurniture(id: string, patch: Patch<FurnitureItem>): void;
  removeFurniture(id: string): void;
  addAnchor(anchor: Anchor): void;
  updateAnchor(id: string, patch: Patch<Anchor>): void;
  removeAnchor(id: string): void;
  undo(): void;
  redo(): void;
}

export function createProjectStore(
  storage: ProjectStorage = createProjectStorage(),
) {
  let hydrationTask: Promise<void> | undefined;
  const pending = new Map<string, Write>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<boolean> | undefined;
  let openRequest = 0;
  let transaction:
    { before: Project; future: Project[]; depth: number } | undefined;

  const store = createStore<ProjectState>()((set, get) => {
    function requireReady() {
      if (get().hydration !== 'ready')
        throw new Error('请先等待本地项目读取完成。');
    }
    function activeProject() {
      requireReady();
      const state = get();
      const project = state.currentProject;
      if (!project) throw new Error('请先打开一个项目。');
      return project;
    }
    function finishTransaction(cancel = false) {
      if (!transaction) return;
      if (!cancel && --transaction.depth > 0) return;
      const { before, future } = transaction;
      transaction = undefined;
      const current = get().currentProject;
      if (!current || current.id !== before.id) {
        set({ transactionActive: false });
        return;
      }
      if (cancel || sameValue(current, before)) {
        set({ currentProject: before, future, transactionActive: false });
        if (current !== before) queueProject(before);
      } else {
        set((state) => ({
          past: [...state.past, before].slice(-HISTORY_LIMIT),
          future: [],
          transactionActive: false,
        }));
      }
    }
    function settleTransaction() {
      if (transaction) transaction.depth = 1;
      finishTransaction();
    }
    function commit(next: Project) {
      const previous = activeProject();
      const parsed = projectSchema.parse(next);

      set((state) => ({
        currentProject: parsed,
        past: transaction
          ? state.past
          : [...state.past, previous].slice(-HISTORY_LIMIT),
        future: [],
      }));
      queueProject(parsed);
    }
    function add(collection: Collection, entity: Entity) {
      const project = activeProject();
      if (project[collection].some((item) => item.id === entity.id)) {
        throw new Error('元素编号已存在。');
      }
      commit({ ...project, [collection]: [...project[collection], entity] });
    }
    function update(collection: Collection, id: string, patch: object) {
      const project = activeProject();
      const item = project[collection].find((item) => item.id === id);
      if (!item) throw new Error('元素不存在。');
      if (item.source === 'manual' && !hasChanges(item, patch)) return;
      commit({
        ...project,
        [collection]: project[collection].map((item) =>
          item.id === id
            ? { ...item, ...patch, id: item.id, source: 'manual' }
            : item,
        ),
      });
    }
    function remove(collection: Collection, id: string) {
      const project = activeProject();
      if (!project[collection].some((item) => item.id === id)) return;
      const next = {
        ...project,
        [collection]: project[collection].filter((item) => item.id !== id),
      };
      if (collection === 'walls') {
        next.openings = project.openings.filter((item) => item.wallId !== id);
      }
      if (collection === 'rooms') {
        next.anchors = project.anchors.filter((item) => item.roomId !== id);
        next.furniture = project.furniture.map((item) => {
          if (item.roomId !== id) return item;
          const remaining = { ...item, source: 'manual' as const };
          delete remaining.roomId;
          return remaining;
        });
      }
      if (collection === 'anchors' || collection === 'rooms') {
        const remaining = new Set(next.anchors.map((item) => item.id));
        next.anchors = next.anchors.map((item) => {
          const links = item.links.filter((link) =>
            remaining.has(link.targetAnchorId),
          );
          return links.length === item.links.length
            ? item
            : { ...item, links, source: 'manual' };
        });
        next.panoramas = project.panoramas.filter((item) =>
          remaining.has(item.anchorId),
        );
      }
      commit(next);
    }
    return {
      transactionActive: false,
      beginTransaction: () => {
        const before = activeProject();
        if (transaction) transaction.depth += 1;
        else transaction = { before, future: get().future, depth: 1 };
        set({ transactionActive: true });
      },
      endTransaction: () => finishTransaction(),
      cancelTransaction: () => finishTransaction(true),
      projects: [],
      currentProject: null,
      projectLoad: 'idle',
      projectError: null,
      activeProjectId: null,
      past: [],
      future: [],
      hydration: 'idle',
      isSaving: false,
      storageError: null,
      hydrate: () => {
        if (get().hydration === 'ready') return Promise.resolve();
        if (hydrationTask) return hydrationTask;
        set({ hydration: 'loading', storageError: null });
        hydrationTask = Promise.resolve().then(async () => {
          try {
            const saved = await storage.loadIndex();
            const projects = projectIndexSchema.parse(
              saved === undefined ? [] : saved,
            );
            set({ projects, hydration: 'ready', storageError: null });
          } catch {
            set({
              hydration: 'error',
              storageError:
                '无法读取本地项目，请检查浏览器存储权限后重试。已有数据未被覆盖。',
            });
          } finally {
            hydrationTask = undefined;
          }
        });
        return hydrationTask;
      },
      flush: flushWrites,
      retrySave: () => {
        requireReady();
        void flushWrites();
      },
      createProject: (name) => {
        requireReady();
        settleTransaction();
        const project = createProject(name);
        openRequest += 1;
        set({
          currentProject: project,
          activeProjectId: project.id,
          projectLoad: 'ready',
          projectError: null,
          past: [],
          future: [],
        });
        queueProject(project);
        return project.id;
      },
      deleteProject: (id) => {
        requireReady();
        if (!get().projects.some((item) => item.id === id)) return;
        if (get().activeProjectId === id) {
          settleTransaction();
          openRequest += 1;
        }
        set((state) => ({
          projects: state.projects.filter((item) => item.id !== id),
          ...(state.activeProjectId === id
            ? {
                activeProjectId: null,
                currentProject: null,
                projectLoad: 'idle',
                projectError: null,
                past: [],
                future: [],
              }
            : {}),
        }));
        schedule(id, { deleted: true });
      },
      readProject: async (id) => {
        requireReady();
        if (!get().projects.some((item) => item.id === id))
          throw new Error('项目不存在或已被删除。');
        const current = get().currentProject;
        if (current?.id === id) return projectSchema.parse(current);
        const dirty = pending.get(id);
        if (dirty && 'project' in dirty)
          return projectSchema.parse(dirty.project);
        // A pending save may already have entered the serialized write queue.
        if (writing) await writing;
        if (!get().projects.some((item) => item.id === id))
          throw new Error('项目不存在或已被删除。');
        const latest = pending.get(id);
        if (latest && 'project' in latest)
          return projectSchema.parse(latest.project);
        const project = projectSchema.parse(await storage.loadProject(id));
        if (project.id !== id) throw new Error('项目编号与存储记录不一致。');
        return project;
      },
      openProject: async (id) => {
        requireReady();
        if (get().currentProject?.id === id) return;
        settleTransaction();
        const request = ++openRequest;
        set({
          activeProjectId: id,
          currentProject: null,
          projectLoad: 'loading',
          projectError: null,
          past: [],
          future: [],
        });
        try {
          const project = await get().readProject(id);
          if (request !== openRequest) return;
          set({
            currentProject: project,
            projectLoad: 'ready',
            projectError: null,
          });
        } catch {
          if (request !== openRequest) return;
          set({
            projectLoad: 'error',
            projectError:
              '无法打开项目：数据不存在或格式错误，请返回列表或重试。已有数据未被覆盖。',
          });
        }
      },
      closeProject: () => {
        settleTransaction();
        openRequest += 1;
        set({
          activeProjectId: null,
          currentProject: null,
          projectLoad: 'idle',
          projectError: null,
          past: [],
          future: [],
        });
        void flushWrites();
      },
      updateProject: (patch) => {
        const project = activeProject();
        // Entity changes must go through their actions to track manual edits.
        const { walls, openings, rooms, furniture, anchors, ...metadata } =
          patch;
        if (walls || openings || rooms || furniture || anchors) {
          throw new Error(
            '请使用元素 action 修改墙体、门窗、房间、家具或锚点。',
          );
        }
        if (!hasChanges(project, metadata)) return;
        commit({ ...project, ...metadata, id: project.id, version: 2 });
      },
      updateBackground: (patch) => {
        const project = activeProject();
        if (!hasChanges(project.background, patch)) return;
        commit({ ...project, background: { ...project.background, ...patch } });
      },
      importProject: (text, overwrite = false) => {
        if (get().hydration !== 'ready')
          return { success: false, error: '请先等待本地项目读取完成。' };
        const result = parseProjectJson(text);
        if (!result.success) return result;
        const project = result.project;
        const exists = get().projects.some((item) => item.id === project.id);
        if (exists && !overwrite)
          return {
            success: false,
            error: '相同编号的项目已存在，确认覆盖后才能导入。',
          };
        settleTransaction();
        openRequest += 1;
        set({
          currentProject: project,
          activeProjectId: project.id,
          projectLoad: 'ready',
          projectError: null,
          past: [],
          future: [],
        });
        queueProject(project);
        return result;
      },
      addWall: (wall) => add('walls', wall),
      updateWall: (id, patch) => update('walls', id, patch),
      removeWall: (id) => remove('walls', id),
      addOpening: (opening) => add('openings', opening),
      updateOpening: (id, patch) => update('openings', id, patch),
      removeOpening: (id) => remove('openings', id),
      addRoom: (room) => add('rooms', room),
      updateRoom: (id, patch) => update('rooms', id, patch),
      removeRoom: (id) => remove('rooms', id),
      addFurniture: (item) => add('furniture', item),
      updateFurniture: (id, patch) => update('furniture', id, patch),
      removeFurniture: (id) => remove('furniture', id),
      addAnchor: (anchor) => add('anchors', anchor),
      updateAnchor: (id, patch) => update('anchors', id, patch),
      removeAnchor: (id) => remove('anchors', id),
      undo: () => {
        settleTransaction();
        const project = activeProject();
        const state = get();
        const previous = state.past.at(-1);
        if (!previous) return;
        set({
          currentProject: previous,
          past: state.past.slice(0, -1),
          future: [project, ...state.future],
        });
        queueProject(previous);
      },
      redo: () => {
        settleTransaction();
        const project = activeProject();
        const state = get();
        const next = state.future[0];
        if (!next) return;
        set({
          currentProject: next,
          past: [...state.past, project].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
        });
        queueProject(next);
      },
    };
  });

  function queueProject(project: Project) {
    const updatedAt = new Date().toISOString();
    const entry = { id: project.id, name: project.name, updatedAt };
    store.setState((state) => ({
      projects: [
        ...state.projects.filter((item) => item.id !== project.id),
        entry,
      ],
    }));
    // Actions validate and detach their arguments; retain only the latest immutable
    // snapshot per dirty project instead of cloning all projects on each edit.
    schedule(project.id, { project, updatedAt });
  }
  function schedule(id: string, write: Write) {
    pending.set(id, write);
    if (timer) clearTimeout(timer);
    store.setState({ isSaving: true });
    timer = setTimeout(() => {
      timer = undefined;
      void flushWrites();
    }, AUTOSAVE_DELAY);
  }
  function flushWrites(): Promise<boolean> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (writing) return writing;
    if (!pending.size)
      return Promise.resolve(
        store.getState().hydration === 'ready' &&
          !store.getState().storageError,
      );
    // Start the first write immediately, including on visibilitychange/pagehide.
    writing = (async () => {
      let failed = false;
      while (pending.size) {
        const batch = [...pending];
        pending.clear();
        for (const [id, write] of batch) {
          try {
            if ('deleted' in write) await storage.delete(id);
            else await storage.save(write.project, write.updatedAt);
          } catch {
            failed = true;
            // Keep failed operations for retry, without replacing a newer edit.
            if (!pending.has(id)) pending.set(id, write);
          }
        }
        if (failed) break;
      }
      if (timer && !pending.size) {
        clearTimeout(timer);
        timer = undefined;
      }
      store.setState({
        isSaving: false,
        storageError: failed
          ? '自动保存失败，修改仍保留在当前页面。请重试或导出 JSON 备份。'
          : null,
      });
      return !failed;
    })().finally(() => {
      writing = undefined;
    });
    return writing;
  }
  return store;
}

function hasChanges(original: object, patch: object) {
  // Compare only patched fields. Nested object patches may intentionally count
  // as an edit; never stringify the project or any embedded image data.
  return Object.entries(patch).some(
    ([key, value]) => !Object.is(Reflect.get(original, key), value),
  );
}

// Compare immutable snapshots without serializing or duplicating embedded images.
function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (
    !first ||
    !second ||
    typeof first !== 'object' ||
    typeof second !== 'object'
  )
    return false;
  const keys = Object.keys(first);
  return (
    keys.length === Object.keys(second).length &&
    keys.every(
      (key) =>
        Object.hasOwn(second, key) &&
        sameValue(Reflect.get(first, key), Reflect.get(second, key)),
    )
  );
}
