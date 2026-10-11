'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Vec2, Wall } from '@/model/types';
import { useProjectStore } from '@/model/provider';
import { pointDistance } from '@/geometry/canvas';
import { pointAtLength, projectToSegment, wallLength } from '@/geometry/walls';
import { pxToMm } from '@/geometry/units';
import { snapPoint, type SnapResult } from '../snapping';

type Drag = { wall: Wall; from: Vec2; endpoint: 'start' | 'end' | null };
export function useWallTool(project: Project) {
  const {
    addWall,
    updateWall,
    removeWall,
    beginTransaction,
    endTransaction,
    cancelTransaction,
    transactionActive,
  } = useProjectStore((state) => state);
  const [tool, setTool] = useState<'select' | 'wall'>('select');
  const [thickness, setThickness] = useState(
    project.settings.defaultWallThickness,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [start, setStart] = useState<Vec2 | null>(null);
  const [preview, setPreview] = useState<SnapResult | null>(null);
  const [direction, setDirection] = useState<Vec2 | null>(null);
  const [lengthInput, setLengthInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const selected = project.walls.find((wall) => wall.id === selectedId);
  const finish = useCallback(() => {
    setStart(null);
    setDirection(null);
    setPreview(null);
    setLengthInput('');
    setError(null);
  }, []);
  const endDrag = useCallback(
    (cancel = false) => {
      if (!drag.current) return;
      drag.current = null;
      setPreview(null);
      if (cancel) cancelTransaction();
      else endTransaction();
    },
    [cancelTransaction, endTransaction],
  );
  const addSegment = useCallback(
    (end: Vec2) => {
      if (!start || pointDistance(start, end) < 0.001) return;
      if (!Number.isFinite(thickness) || thickness <= 0) {
        setError('请输入大于零的墙厚（mm）。');
        return;
      }
      addWall({
        id: crypto.randomUUID(),
        start,
        end,
        thickness,
        source: 'manual',
      });
      setStart(end);
      setDirection(null);
      setPreview(null);
      setLengthInput('');
      setError(null);
    },
    [start, thickness, addWall],
  );
  const commitLength = useCallback(() => {
    if (!start) return;
    try {
      addSegment(
        pointAtLength(
          start,
          direction ?? preview?.point ?? start,
          Number(lengthInput),
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '墙体长度无效。');
    }
  }, [start, direction, preview, lengthInput, addSegment]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        endDrag();
        finish();
        return;
      }
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        endDrag(true);
        finish();
        return;
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        tool === 'select' &&
        selected
      ) {
        event.preventDefault();
        endDrag();
        removeWall(selected.id);
        setSelectedId(null);
      }
      if (
        tool !== 'wall' ||
        !start ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (/^[0-9.]$/.test(event.key)) {
        event.preventDefault();
        setLengthInput((current) => current + event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setLengthInput((current) => current.slice(0, -1));
      } else if (event.key === 'Enter' && lengthInput) {
        event.preventDefault();
        commitLength();
      }
    }
    document.addEventListener('keydown', key);
    const blur = () => endDrag();
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [
    tool,
    selected,
    start,
    lengthInput,
    finish,
    endDrag,
    commitLength,
    removeWall,
  ]);
  // Switching steps or projects must never leave the store inside a drag batch.
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        endTransaction();
      }
    },
    [endTransaction],
  );

  function move(point: Vec2, mmPerScreenPixel: number, shift: boolean) {
    const dragging = drag.current;
    if (dragging) {
      if (!transactionActive) {
        drag.current = null;
        return;
      }
      const { wall, from, endpoint } = dragging;
      const current = project.walls.find((item) => item.id === wall.id);
      if (!current) {
        endDrag();
        return;
      }
      if (endpoint) {
        const result = snapPoint(point, project.walls, {
          mmPerScreenPixel,
          shift,
          origin: wall[endpoint === 'start' ? 'end' : 'start'],
          excludeWallId: wall.id,
        });
        if (
          pointDistance(
            result.point,
            wall[endpoint === 'start' ? 'end' : 'start'],
          ) < 0.001
        )
          return;
        if (pointDistance(current[endpoint], result.point) < 0.001) return;
        updateWall(wall.id, { [endpoint]: result.point });
        setPreview(result);
      } else {
        const result = snapPoint(
          {
            x: wall.start.x + point.x - from.x,
            y: wall.start.y + point.y - from.y,
          },
          project.walls,
          { mmPerScreenPixel, shift: true, excludeWallId: wall.id },
        );
        const delta = {
          x: result.point.x - wall.start.x,
          y: result.point.y - wall.start.y,
        };
        const end = { x: wall.end.x + delta.x, y: wall.end.y + delta.y };
        if (
          pointDistance(current.start, result.point) < 0.001 &&
          pointDistance(current.end, end) < 0.001
        )
          return;
        updateWall(wall.id, {
          start: result.point,
          end: { x: wall.end.x + delta.x, y: wall.end.y + delta.y },
        });
        setPreview(result);
      }
    } else if (tool === 'wall') {
      const result = snapPoint(point, project.walls, {
        mmPerScreenPixel,
        shift,
        origin: start ?? undefined,
      });
      setPreview(result);
      setDirection(
        start && pointDistance(start, result.point) < 0.001
          ? snapPoint(point, [], { mmPerScreenPixel, shift, origin: start })
              .point
          : result.point,
      );
    }
  }
  function down(point: Vec2, mmPerScreenPixel: number, shift: boolean) {
    setError(null);
    if (tool === 'wall') {
      const result = snapPoint(point, project.walls, {
        mmPerScreenPixel,
        shift,
        origin: start ?? undefined,
      });
      if (!start) setStart(result.point);
      else addSegment(result.point);
      return;
    }
    let endpoint: 'start' | 'end' | null = null;
    let wall = selected;
    if (wall)
      endpoint =
        (['start', 'end'] as const).find(
          (end) =>
            pointDistance(point, wall![end]) <= pxToMm(10, mmPerScreenPixel),
        ) ?? null;
    if (!endpoint) {
      wall = [...project.walls]
        .reverse()
        .find(
          (item) =>
            pointDistance(
              point,
              projectToSegment(point, item.start, item.end),
            ) <=
            item.thickness / 2 + pxToMm(4, mmPerScreenPixel),
        );
    }
    setSelectedId(wall?.id ?? null);
    if (wall) {
      beginTransaction();
      drag.current = { wall, from: point, endpoint };
    }
  }
  return {
    tool,
    thickness,
    setThickness,
    selected,
    start,
    preview,
    lengthInput,
    setLengthInput,
    commitLength,
    error,
    chooseTool(next: 'select' | 'wall') {
      endDrag();
      finish();
      setSelectedId(null);
      setTool(next);
    },
    finish,
    down,
    move,
    endDrag,
    dragging: () => Boolean(drag.current),
    removeSelected() {
      if (selected) {
        endDrag();
        removeWall(selected.id);
        setSelectedId(null);
      }
    },
    changeSelectedThickness(value: number) {
      if (selected && Number.isFinite(value) && value > 0) {
        updateWall(selected.id, { thickness: value });
        setError(null);
      } else setError('请输入大于零的墙厚（mm）。');
    },
    previewLength:
      start && preview ? wallLength({ start, end: preview.point }) : null,
  };
}
export type WallTool = ReturnType<typeof useWallTool>;
