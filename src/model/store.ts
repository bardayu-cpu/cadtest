import { createStore } from 'zustand/vanilla';
import { createProject, parseProjectJson, type ImportResult } from './project';
import { projectSchema, projectsSchema } from './schema';
import { createProjectStorage, type ProjectStorage } from './storage';
import type {
  Anchor,
  FurnitureItem,
  Opening,
  Project,
  Room,
  Wall,
} from './types';

export const HISTORY_LIMIT = 100;
type Collection = 'walls' | 'openings' | 'rooms' | 'furniture' | 'anchors';
type Entity = Wall | Opening | Room | FurnitureItem | Anchor;
type Patch<T> = Partial<Omit<T, 'id' | 'source'>>;

export interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
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
  openProject(id: string): void;
  closeProject(): void;
  updateProject(patch: Partial<Omit<Project, 'id' | 'version'>>): void;
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
  let writes = Promise.resolve();
  let pendingWrites = 0;

  const store = createStore<ProjectState>()((set, get) => {
    function requireReady() {
      if (get().hydration !== 'ready')
        throw new Error('请先等待本地项目读取完成。');
    }
    function activeProject() {
      requireReady();
      const state = get();
      const project = state.projects.find(
        (item) => item.id === state.activeProjectId,
      );
      if (!project) throw new Error('请先打开一个项目。');
      return project;
    }
    function commit(next: Project) {
      const previous = activeProject();
      const parsed = projectSchema.parse(next);
      if (JSON.stringify(previous) === JSON.stringify(parsed)) return;
      set((state) => ({
        projects: state.projects.map((item) =>
          item.id === previous.id ? parsed : item,
        ),
        past: [...state.past, previous].slice(-HISTORY_LIMIT),
        future: [],
      }));
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
      if (!project[collection].some((item) => item.id === id))
        throw new Error('元素不存在。');
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
      if (collection === 'anchors') {
        next.anchors = next.anchors.map((item) => {
          const links = item.links.filter((link) => link.targetAnchorId !== id);
          return links.length === item.links.length
            ? item
            : { ...item, links, source: 'manual' };
        });
        next.panoramas = project.panoramas.filter(
          (item) => item.anchorId !== id,
        );
      }
      commit(next);
    }
    return {
      projects: [],
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
            const saved = await storage.load();
            const projects = projectsSchema.parse(
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
      flush: async () => {
        await writes;
        return get().hydration === 'ready' && !get().storageError;
      },
      retrySave: () => {
        requireReady();
        enqueueSave(get().projects);
      },
      createProject: (name) => {
        requireReady();
        const project = createProject(name);
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: project.id,
          past: [],
          future: [],
        }));
        return project.id;
      },
      deleteProject: (id) => {
        requireReady();
        if (!get().projects.some((item) => item.id === id)) return;
        set((state) => ({
          projects: state.projects.filter((item) => item.id !== id),
          ...(state.activeProjectId === id
            ? { activeProjectId: null, past: [], future: [] }
            : {}),
        }));
      },
      openProject: (id) => {
        requireReady();
        if (!get().projects.some((item) => item.id === id))
          throw new Error('项目不存在或已被删除。');
        if (get().activeProjectId !== id)
          set({ activeProjectId: id, past: [], future: [] });
      },
      closeProject: () => set({ activeProjectId: null, past: [], future: [] }),
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
        commit({ ...project, ...metadata, id: project.id, version: 2 });
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
        set((state) => ({
          projects: exists
            ? state.projects.map((item) =>
                item.id === project.id ? project : item,
              )
            : [...state.projects, project],
          activeProjectId: project.id,
          past: [],
          future: [],
        }));
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
        const project = activeProject();
        const state = get();
        const previous = state.past.at(-1);
        if (!previous) return;
        set({
          projects: state.projects.map((item) =>
            item.id === project.id ? previous : item,
          ),
          past: state.past.slice(0, -1),
          future: [project, ...state.future],
        });
      },
      redo: () => {
        const project = activeProject();
        const state = get();
        const next = state.future[0];
        if (!next) return;
        set({
          projects: state.projects.map((item) =>
            item.id === project.id ? next : item,
          ),
          past: [...state.past, project].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
        });
      },
    };
  });

  function enqueueSave(projects: Project[]) {
    // Serialize writes: a slower earlier save must never overwrite a later edit.
    const snapshot = structuredClone(projects);
    pendingWrites += 1;
    store.setState({ isSaving: true });
    writes = writes.then(async () => {
      try {
        await storage.save(snapshot);
        store.setState({ storageError: null });
      } catch {
        store.setState({
          storageError:
            '自动保存失败，修改仍保留在当前页面。请重试或导出 JSON 备份。',
        });
      } finally {
        pendingWrites -= 1;
        store.setState({ isSaving: pendingWrites > 0 });
      }
    });
  }
  store.subscribe((state, previous) => {
    if (previous.hydration === 'ready' && state.projects !== previous.projects)
      enqueueSave(state.projects);
  });
  return store;
}
