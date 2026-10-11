'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Stage,
} from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Project, Vec2 } from '@/model/types';
import { mmToPx } from '@/geometry/units';
import {
  fitImage,
  screenToImage,
  screenToMm,
  zoomAt,
  type Size,
  type Viewport,
} from '@/geometry/canvas';

interface Props {
  background: Project['background'];
  image?: HTMLImageElement;
  visible: boolean;
  points: Vec2[];
  selecting: boolean;
  onPick(point: Vec2): void;
}

export function Canvas2D({
  background,
  image,
  visible,
  points,
  selecting,
  onPick,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const space = useRef(false);
  const drag = useRef<{ pointer: Vec2; viewport: Viewport } | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [savedView, setSavedView] = useState<{
    image?: HTMLImageElement;
    size: Size;
    value: Viewport;
  } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [holdingSpace, setHoldingSpace] = useState(false);
  const viewport =
    savedView !== null &&
    savedView.image === image &&
    savedView.size.width === size.width &&
    savedView.size.height === size.height
      ? savedView.value
      : image && size.width
        ? fitImage(
            { width: image.naturalWidth, height: image.naturalHeight },
            size,
            background,
          )
        : { x: 0, y: 0, scale: 1 };
  const imageOffset = {
    x: mmToPx(background.offset.x, background.mmPerPixel),
    y: mmToPx(background.offset.y, background.mmPerPixel),
  };

  function updateView(value: Viewport) {
    setSavedView({ image, size, value });
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
  }, []);

  function pointerDown(event: KonvaEventObject<PointerEvent>) {
    if (event.evt.button !== 0) return;
    container.current?.focus({ preventScroll: true });
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    if (space.current) {
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
    if (drag.current) {
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
    if (!pointer || event.evt.deltaY === 0) return;
    const direction =
      (event.evt.deltaY > 0 ? -1 : 1) * (event.evt.ctrlKey ? -1 : 1);
    const next = zoomAt(viewport, pointer, direction > 0 ? 1.12 : 1 / 1.12);
    updateView(next);
    setCursor(pointer);
  }
  const mouseMm = cursor
    ? screenToMm(cursor, viewport, background.mmPerPixel)
    : null;
  const worldPoints = points.map((point) => ({
    x: point.x + imageOffset.x,
    y: point.y + imageOffset.y,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>滚轮缩放 · 画布内按住空格拖动平移</span>
        <button
          type="button"
          disabled={!image}
          className="shrink-0 text-emerald-800 underline disabled:opacity-40"
          onClick={() => {
            if (image)
              updateView(
                fitImage(
                  { width: image.naturalWidth, height: image.naturalHeight },
                  size,
                  background,
                ),
              );
          }}
        >
          适应画布
        </button>
      </div>
      <div
        ref={container}
        role="region"
        aria-label="户型图画布"
        tabIndex={0}
        className="relative h-[min(65vh,640px)] min-h-[360px] overflow-hidden rounded-xl bg-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        style={{
          touchAction: 'none',
          cursor: holdingSpace ? 'grab' : selecting ? 'crosshair' : 'default',
          backgroundImage: 'radial-gradient(#d6d3d1 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        data-viewport-x={viewport.x}
        data-viewport-y={viewport.y}
        data-viewport-scale={viewport.scale}
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
        {!background.imageDataUrl && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-stone-500">
            上传户型图后，在尺寸线两端选点进行校准。
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums text-stone-600">
        <span aria-label="鼠标位置">
          {mouseMm
            ? `X：${mouseMm.x.toFixed(1)} mm · Y：${mouseMm.y.toFixed(1)} mm`
            : '将鼠标移入画布查看毫米坐标'}
        </span>
        <span aria-label="画布缩放">
          缩放：{(viewport.scale * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
