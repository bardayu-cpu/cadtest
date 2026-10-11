'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Stage,
  Text as KonvaText,
} from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Project, Vec2 } from '@/model/types';
import { mmToPx } from '@/geometry/units';
import {
  fitImage,
  screenToImage,
  screenToMm,
  wheelViewport,
  pointDistance,
  screenToCanvas,
  type Size,
  type Viewport,
} from '@/geometry/canvas';

interface Props {
  background: Project['background'];
  image?: HTMLImageElement;
  visible: boolean;
  points: Vec2[];
  selecting: boolean;
  fitVersion: number;
  locked: boolean;
  calibrated: boolean;
  draggingFile: boolean;
  uploading: boolean;
  sidebarOpen: boolean;
  onChooseFile(): void;
  onToggleSidebar(): void;
  onToggleLock(): void;
  onPick(point: Vec2): void;
}

export function Canvas2D({
  background,
  image,
  visible,
  points,
  selecting,
  onPick,
  fitVersion,
  locked,
  calibrated,
  draggingFile,
  uploading,
  sidebarOpen,
  onChooseFile,
  onToggleSidebar,
  onToggleLock,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const space = useRef(false);
  const drag = useRef<{ pointer: Vec2; viewport: Viewport } | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [savedView, setSavedView] = useState<{
    image?: HTMLImageElement;
    fitVersion: number;
    size: Size;
    value: Viewport;
  } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [holdingSpace, setHoldingSpace] = useState(false);
  const viewport =
    savedView !== null &&
    savedView.image === image &&
    savedView.fitVersion === fitVersion &&
    savedView.size.width === size.width &&
    savedView.size.height === size.height
      ? savedView.value
      : image && size.width
        ? fitImage(
            { width: image.naturalWidth, height: image.naturalHeight },
            size,
            background,
            { top: 64, bottom: 16 },
          )
        : { x: 0, y: 0, scale: 1 };
  const imageOffset = {
    x: mmToPx(background.offset.x, background.mmPerPixel),
    y: mmToPx(background.offset.y, background.mmPerPixel),
  };

  function updateView(value: Viewport) {
    setSavedView({ image, fitVersion, size, value });
  }
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function release() {
      space.current = false;
      drag.current = null;
      setHoldingSpace(false);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.defaultPrevented || event.isComposing)
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if (
        !hovered.current &&
        !container.current?.contains(event.target as Node)
      )
        return;
      event.preventDefault();
      space.current = true;
      if (locked) return;
      setHoldingSpace(true);
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === 'Space') release();
    }
    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', keyUp);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', release);
    };
  }, [locked]);

  function pointerDown(event: KonvaEventObject<PointerEvent>) {
    if (event.evt.button !== 0) return;
    container.current?.focus({ preventScroll: true });
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    setCursor(pointer);
    if (space.current) {
      if (locked) return;
      event.evt.preventDefault();
      drag.current = { pointer, viewport };
      if (event.evt.target instanceof HTMLElement)
        event.evt.target.setPointerCapture(event.evt.pointerId);
    } else if (selecting && image && visible) {
      const point = screenToImage(pointer, viewport, background);
      if (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= image.naturalWidth &&
        point.y <= image.naturalHeight
      )
        onPick(point);
    }
  }
  function pointerMove(event: KonvaEventObject<PointerEvent>) {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    let view = viewport;
    if (drag.current && !locked) {
      const start = drag.current;
      view = {
        ...start.viewport,
        x: start.viewport.x + pointer.x - start.pointer.x,
        y: start.viewport.y + pointer.y - start.pointer.y,
      };
      updateView(view);
    }
    setCursor(pointer);
  }
  function wheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    updateView(wheelViewport(viewport, pointer, event.evt, size, locked));
    setCursor(pointer);
  }
  const mouseMm = cursor
    ? screenToMm(cursor, viewport, background.mmPerPixel)
    : null;
  const worldPoints = points.map((point) => ({
    x: point.x + imageOffset.x,
    y: point.y + imageOffset.y,
  }));

  const preview =
    selecting && points.length === 1 && cursor
      ? screenToCanvas(cursor, viewport)
      : null;
  const previewLength = preview ? pointDistance(worldPoints[0], preview) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={container}
        role="region"
        aria-label="户型图画布"
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-hidden bg-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
        style={{
          touchAction: 'none',
          cursor:
            holdingSpace && !locked
              ? 'grab'
              : selecting
                ? 'crosshair'
                : 'default',
          backgroundImage: 'radial-gradient(#d6d3d1 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        data-viewport-x={viewport.x}
        data-viewport-y={viewport.y}
        data-viewport-scale={viewport.scale}
        data-view-locked={locked}
        data-image-width={image?.naturalWidth}
        data-image-height={image?.naturalHeight}
        onPointerEnter={() => {
          hovered.current = true;
        }}
        onPointerLeave={() => {
          hovered.current = false;
          if (!drag.current) setCursor(null);
        }}
      >
        {size.width > 0 && size.height > 0 && (
          <Stage
            width={size.width}
            height={size.height}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onWheel={wheel}
          >
            <Layer>
              <Group
                x={viewport.x}
                y={viewport.y}
                scaleX={viewport.scale}
                scaleY={viewport.scale}
              >
                {image && (
                  <KonvaImage
                    image={image}
                    x={imageOffset.x}
                    y={imageOffset.y}
                    opacity={background.opacity}
                    visible={visible}
                    listening={false}
                  />
                )}
                {preview && (
                  <>
                    <Line
                      points={[
                        worldPoints[0].x,
                        worldPoints[0].y,
                        preview.x,
                        preview.y,
                      ]}
                      stroke="#f59e0b"
                      strokeWidth={2 / viewport.scale}
                      dash={[6 / viewport.scale, 4 / viewport.scale]}
                      listening={false}
                    />
                    <KonvaText
                      x={preview.x + 12 / viewport.scale}
                      y={preview.y + 12 / viewport.scale}
                      text={`${previewLength?.toFixed(1)} px`}
                      fontSize={13 / viewport.scale}
                      fill="#fbbf24"
                      padding={4 / viewport.scale}
                      listening={false}
                    />
                  </>
                )}
                {worldPoints.length === 2 && (
                  <Line
                    points={worldPoints.flatMap((point) => [point.x, point.y])}
                    stroke="#f59e0b"
                    strokeWidth={2 / viewport.scale}
                    dash={[6 / viewport.scale, 4 / viewport.scale]}
                    listening={false}
                  />
                )}
                {worldPoints.map((point, index) => (
                  <Circle
                    key={index}
                    x={point.x}
                    y={point.y}
                    radius={5 / viewport.scale}
                    fill="#f59e0b"
                    stroke="white"
                    strokeWidth={2 / viewport.scale}
                    listening={false}
                  />
                ))}
              </Group>
            </Layer>
          </Stage>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
          <span className="hidden rounded-md bg-white/90 px-2 py-1.5 text-[11px] text-stone-600 shadow-sm md:inline">
            两指滑动 / 滚轮平移 · Cmd / Ctrl + 滚轮缩放 · 空格拖动平移
          </span>
          <div className="pointer-events-auto ml-auto flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white/95 p-1 shadow-sm">
            <button
              type="button"
              aria-label={locked ? '解锁视图' : '锁定视图'}
              aria-pressed={locked}
              title={
                locked
                  ? '视图已锁定；点击解锁后可平移、缩放'
                  : '锁定后禁止平移、缩放'
              }
              className="rounded px-2 py-1 text-xs hover:bg-stone-100"
              onClick={onToggleLock}
            >
              <span aria-hidden="true">{locked ? '🔒' : '🔓'}</span>{' '}
              {locked ? '已锁定' : '锁定视图'}
            </button>
            <button
              type="button"
              disabled={!image}
              className="rounded px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-40"
              onClick={() => {
                if (image)
                  updateView(
                    fitImage(
                      {
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      },
                      size,
                      background,
                      { top: 64, bottom: 16 },
                    ),
                  );
              }}
            >
              适应画布
            </button>
            <button
              type="button"
              aria-expanded={sidebarOpen}
              aria-controls="editor-sidebar"
              aria-label={sidebarOpen ? '收起画布侧栏' : '展开侧栏'}
              className="rounded px-2 py-1 text-xs text-emerald-800 hover:bg-stone-100"
              onClick={onToggleSidebar}
            >
              {sidebarOpen ? '收起侧栏 →' : '← 画布控件'}
            </button>
          </div>
        </div>
        {!background.imageDataUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <button
              type="button"
              disabled={uploading}
              className="pointer-events-auto w-full max-w-md rounded-2xl border-2 border-dashed border-emerald-300 bg-white/90 p-8 text-center shadow-sm hover:border-emerald-700 disabled:opacity-40"
              onClick={onChooseFile}
            >
              <span
                aria-hidden="true"
                className="mb-4 block text-3xl text-emerald-800"
              >
                ↑
              </span>
              <span className="block text-base font-medium">
                把户型图拖到这里，或点击选择文件
              </span>
              <span className="mt-3 block text-xs text-stone-500">
                也可 Cmd / Ctrl + V 粘贴截图
              </span>
            </button>
          </div>
        )}
        {uploading && (
          <p
            aria-live="polite"
            className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-white/90 px-3 py-2 text-sm text-stone-600"
          >
            正在处理户型图…
          </p>
        )}
        {draggingFile && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-4 border-emerald-600 bg-emerald-100/85">
            <p className="rounded-xl bg-emerald-800 px-8 py-5 text-xl font-semibold text-white shadow-lg">
              松开即可上传
            </p>
          </div>
        )}
      </div>
      <div className="flex h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 border-t border-stone-200 bg-white px-3 text-[11px] tabular-nums text-stone-500 md:h-7">
        <span aria-label="鼠标位置">
          {mouseMm
            ? `X：${mouseMm.x.toFixed(1)} mm · Y：${mouseMm.y.toFixed(1)} mm`
            : '将鼠标移入画布查看毫米坐标'}
        </span>
        <span aria-label="校准像素长度">
          {previewLength !== null ? `预览：${previewLength.toFixed(1)} px` : ''}
        </span>
        {!calibrated && (
          <span className="text-amber-700">尚未校准，尺寸仅供参考</span>
        )}
        <span aria-label="画布缩放">
          缩放：{(viewport.scale * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
