import { exportProjectJson } from './project';
import type { Project } from './types';

export function downloadProject(project: Project) {
  const blob = new Blob([exportProjectJson(project)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
