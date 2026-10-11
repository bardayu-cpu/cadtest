export interface EditorUiSettings {
  locked: boolean;
  calibrations: string[];
}
const defaults = (): EditorUiSettings => ({ locked: true, calibrations: [] });
const settingsKey = (projectId: string) => `cadtest:editor-ui:${projectId}`;

// A compact identity avoids duplicating the full image in localStorage.
// This is only a UI marker, never a security or content-integrity check.
export function imageIdentity(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return `${source.length}-${hash >>> 0}`;
}
export function calibrationIdentity(
  source: string,
  mmPerPixel: number,
): string {
  return `${imageIdentity(source)}:${mmPerPixel}`;
}
export function readEditorUiSettings(projectId: string): EditorUiSettings {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(settingsKey(projectId)) || 'null',
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('locked' in value) ||
      typeof value.locked !== 'boolean'
    )
      return defaults();
    return {
      locked: value.locked,
      calibrations:
        'calibrations' in value && Array.isArray(value.calibrations)
          ? value.calibrations
              .filter((item): item is string => typeof item === 'string')
              .slice(-100)
          : [],
    };
  } catch {
    return defaults();
  }
}
export function saveEditorUiSettings(
  projectId: string,
  settings: EditorUiSettings,
): void {
  try {
    localStorage.setItem(settingsKey(projectId), JSON.stringify(settings));
  } catch {
    /* Keep the current session usable if browser storage is unavailable. */
  }
}
