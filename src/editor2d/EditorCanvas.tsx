'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { Project, Vec2 } from '@/model/types';
import { useProjectStore } from '@/model/provider';
import { calibrationScale, pointDistance } from '@/geometry/canvas';
import { pxToMm } from '@/geometry/units';
import { Canvas2D } from './Canvas2D';
import { useWallTool, type WallTool } from './tools/useWallTool';
import { WallControls } from './tools/WallControls';
import { loadImage, sanitizeFloorPlan } from './image';
import {
  calibrationIdentity,
  imageIdentity,
  readEditorUiSettings,
  saveEditorUiSettings,
  type EditorUiSettings,
} from './ui-settings';

const buttonClass =
  'rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-40';

export function EditorCanvas({ project }: { project: Project }) {
  const background = project.background;
  const wallEditor = useWallTool(project);
  const finishWall = wallEditor.finish;
  const updateBackground = useProjectStore((state) => state.updateBackground);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const uploadRequest = useRef(0);
  const [loaded, setLoaded] = useState<{
    source: string;
    image?: HTMLImageElement;
    error?: string;
  } | null>(null);
  const [settings, setSettings] = useState(() =>
    readEditorUiSettings(project.id),
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  const [visible, setVisible] = useState(true);
  const [fitVersion, setFitVersion] = useState(0);
  const [draggingFile, setDraggingFile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deferredSource, setDeferredSource] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    source: string;
    points: Vec2[];
  } | null>(null);
  const calibrating = selection?.source === background.imageDataUrl;
  const points = calibrating && selection ? selection.points : [];
  const identity = useMemo(
    () => calibrationIdentity(background.imageDataUrl, background.mmPerPixel),
    [background.imageDataUrl, background.mmPerPixel],
  );
  const calibrated = Boolean(
    background.imageDataUrl && settings.calibrations.includes(identity),
  );
  const image =
    loaded?.source === background.imageDataUrl ? loaded.image : undefined;
  const imageError =
    loaded?.source === background.imageDataUrl ? loaded.error : undefined;
  const loading = Boolean(background.imageDataUrl && !image && !imageError);
  const canCalibrate = Boolean(
    image && visible && background.opacity > 0 && !uploading,
  );
  const step = calibrating ? (points.length === 2 ? 3 : 2) : 1;

  const changeSettings = useCallback(
    (change: (current: EditorUiSettings) => EditorUiSettings) => {
      setSettings((current) => {
        const next = change(current);
        saveEditorUiSettings(project.id, next);
        return next;
      });
    },
    [project.id],
  );
  useEffect(() => {
    const source = background.imageDataUrl;
    if (!source) return;
    let cancelled = false;
    loadImage(source)
      .then((image) => {
        if (!cancelled) setLoaded({ source, image });
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({
            source,
            error: '无法显示已保存的户型图，请重新上传有效图片。',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [background.imageDataUrl]);
  useEffect(
    () => () => {
      uploadRequest.current += 1;
    },
    [],
  );

  const upload = useCallback(
    async (file: File) => {
      const request = ++uploadRequest.current;
      setUploading(true);
      setError(null);
      setMessage(null);
      try {
        const imageDataUrl = await sanitizeFloorPlan(file);
        if (request !== uploadRequest.current) return;
        if (background.imageDataUrl && !window.confirm('替换当前底图？'))
          return;
        updateBackground({
          imageDataUrl,
          mmPerPixel: 1,
          offset: { x: 0, y: 0 },
        });
        const imageKey = imageIdentity(imageDataUrl);
        changeSettings((current) => ({
          locked: true,
          calibrations: current.calibrations.filter(
            (item) => !item.startsWith(`${imageKey}:`),
          ),
        }));
        finishWall();
        setVisible(true);
        setFitVersion((current) => current + 1);
        setSelection(null);
        setDeferredSource(null);
        setSidebarOpen(true);
        setMessage('上传完成，请按右侧三步引导校准真实尺寸。');
      } catch (error) {
        if (request === uploadRequest.current)
          setError(
            error instanceof Error
              ? error.message
              : '图片处理失败，请重新上传。',
          );
      } finally {
        if (request === uploadRequest.current) setUploading(false);
      }
    },
    [background.imageDataUrl, updateBackground, changeSettings, finishWall],
  );
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"]',
          ))
      )
        return;
      const item = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === 'file',
      );
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void upload(file);
    }
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [upload]);

  function cancelCalibration() {
    setSelection(null);
    setError(null);
  }
  function beginCalibration() {
    wallEditor.chooseTool('select');
    setSelection({ source: background.imageDataUrl, points: [] });
    setError(null);
    setMessage(null);
    setDeferredSource(null);
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  }
  function calibrate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCalibrate || !calibrating || points.length !== 2) return;
    try {
      const distance = Number(
        new FormData(event.currentTarget).get('distance'),
      );
      const mmPerPixel = calibrationScale(points[0], points[1], distance);
      updateBackground({ mmPerPixel });
      const marker = calibrationIdentity(background.imageDataUrl, mmPerPixel);
      changeSettings((current) => ({
        ...current,
        calibrations: [
          ...current.calibrations.filter((item) => item !== marker),
          marker,
        ].slice(-100),
      }));
      setSelection(null);
      setError(null);
      setMessage(
        `校准完成：1 像素 = ${mmPerPixel.toFixed(6)} mm。已有几何体的毫米坐标保持不变。`,
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '校准失败，请重新选点。',
      );
    }
  }

  return (
    <section
      aria-label="编辑画布"
      className="relative flex min-h-0 flex-1 overflow-hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancelCalibration();
      }}
    >
      <input
        ref={fileInput}
        type="file"
        aria-label="上传户型图"
        accept="image/jpeg,image/png,image/webp"
        disabled={uploading}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload(file);
        }}
      />
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            dragDepth.current += 1;
            setDraggingFile(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDraggingFile(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDraggingFile(false);
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        }}
      >
        <Canvas2D
          wallEditor={{
            ...wallEditor,
            chooseTool(next: WallTool['tool']) {
              cancelCalibration();
              wallEditor.chooseTool(next);
            },
          }}
          walls={project.walls}
          background={background}
          image={image}
          visible={visible}
          points={points}
          selecting={canCalibrate && calibrating && points.length < 2}
          fitVersion={fitVersion}
          locked={settings.locked}
          calibrated={calibrated}
          draggingFile={draggingFile}
          uploading={uploading || loading}
          sidebarOpen={sidebarOpen}
          onChooseFile={() => fileInput.current?.click()}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleLock={() =>
            changeSettings((current) => ({
              ...current,
              locked: !current.locked,
            }))
          }
          onPick={(point) => {
            if (
              points.length === 1 &&
              window.matchMedia('(max-width: 767px)').matches
            )
              setSidebarOpen(true);
            setSelection((current) =>
              current?.source === background.imageDataUrl &&
              current.points.length < 2
                ? { ...current, points: [...current.points, point] }
                : current,
            );
          }}
        />
        {(error || imageError) && (
          <p
            role="alert"
            className="absolute left-4 right-4 top-16 z-50 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error || imageError}
          </p>
        )}
      </div>
      {sidebarOpen && (
        <aside
          id="editor-sidebar"
          aria-label="画布控件"
          className="absolute inset-y-0 right-0 z-30 w-[280px] shrink-0 space-y-5 overflow-y-auto border-l border-stone-200 bg-white p-4 shadow-lg md:relative md:shadow-none"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">户型图编辑</h2>
            <button
              type="button"
              aria-label="收起侧栏"
              className="text-xs text-stone-500 underline"
              onClick={() => setSidebarOpen(false)}
            >
              收起
            </button>
          </div>
          {(wallEditor.tool === 'wall' || wallEditor.selected) && (
            <WallControls editor={wallEditor} />
          )}
          <button
            type="button"
            className={`${buttonClass} w-full`}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {background.imageDataUrl ? '替换户型图' : '选择户型图'}
          </button>
          <p className="text-xs leading-relaxed text-stone-500">
            支持拖入图片或 Cmd / Ctrl + V 粘贴截图。JPG / PNG / WebP，最大 20
            MB；仅保存在当前浏览器，已去除源图 EXIF。
          </p>
          <div className="space-y-4 border-y border-stone-100 py-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visible}
                disabled={!image}
                onChange={(event) => {
                  setVisible(event.currentTarget.checked);
                  cancelCalibration();
                }}
              />
              显示户型图
            </label>
            <label className="flex flex-wrap items-center justify-between gap-2">
              底图透明度
              <span className="tabular-nums text-stone-500">
                {Math.round(background.opacity * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={background.opacity}
                disabled={!image || uploading}
                className="w-full accent-emerald-800"
                onChange={(event) =>
                  updateBackground({
                    opacity: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
          </div>
          {background.imageDataUrl ? (
            <section
              aria-label="校准引导"
              className={`space-y-3 rounded-xl border p-3 ${calibrated && !calibrating ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
            >
              <h3 className="text-sm font-semibold">
                {calibrated && !calibrating ? '✓ 已校准' : '校准真实尺寸'}
              </h3>
              {calibrated && !calibrating ? (
                <>
                  <p className="text-xs leading-relaxed text-emerald-900">
                    1 像素 = {background.mmPerPixel.toFixed(6)}{' '}
                    mm。已有几何体的毫米坐标保持不变。
                  </p>
                  <button
                    type="button"
                    disabled={!canCalibrate}
                    className={buttonClass}
                    onClick={beginCalibration}
                  >
                    重新校准
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-amber-950">
                    告诉系统图上的距离对应多少毫米，之后画出的墙才有真实尺寸。
                  </p>
                  {deferredSource === background.imageDataUrl &&
                  !calibrating ? (
                    <p className="text-xs text-stone-600">
                      已跳过，可随时回来校准。
                    </p>
                  ) : (
                    <ol className="space-y-2 text-xs leading-relaxed">
                      {[
                        '在图上找一条标了数字的尺寸线，例如顶部的 15040。',
                        '依次点击这条线的两端。',
                        '输入线上的数字，单位：毫米。',
                      ].map((text, index) => (
                        <li
                          key={text}
                          aria-current={step === index + 1 ? 'step' : undefined}
                          className={`rounded-lg p-2 ${step === index + 1 ? 'bg-amber-200 font-medium text-amber-950' : 'text-stone-500'}`}
                        >
                          <span className="mr-1">{['①', '②', '③'][index]}</span>
                          {text}
                        </li>
                      ))}
                    </ol>
                  )}
                  {calibrating && points.length < 2 && (
                    <p
                      aria-live="polite"
                      className="text-xs font-medium text-amber-900"
                    >
                      请点击第 {points.length + 1} 个端点；按 Esc 取消。
                    </p>
                  )}
                  {!calibrating && (
                    <button
                      type="button"
                      aria-label="手动校准"
                      disabled={!canCalibrate}
                      className={`${buttonClass} w-full bg-white`}
                      onClick={beginCalibration}
                    >
                      开始选点
                    </button>
                  )}
                </>
              )}
              {calibrating && points.length === 2 && (
                <form onSubmit={calibrate} className="space-y-3">
                  <label className="flex flex-col gap-2 text-sm">
                    真实距离（mm）
                    <input
                      name="distance"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="例如 15040"
                      required
                      autoFocus
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2"
                    />
                  </label>
                  <span
                    aria-label="当前两点距离"
                    className="block text-xs tabular-nums"
                  >
                    当前两点距离：
                    {pxToMm(
                      pointDistance(points[0], points[1]),
                      background.mmPerPixel,
                    ).toFixed(2)}{' '}
                    mm
                  </span>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-emerald-800 px-3 py-2 text-sm text-white"
                  >
                    应用校准
                  </button>
                </form>
              )}
              {calibrating && (
                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    className="text-amber-950 underline"
                    onClick={beginCalibration}
                  >
                    重新选点
                  </button>
                  <button
                    type="button"
                    className="text-amber-950 underline"
                    onClick={cancelCalibration}
                  >
                    取消校准
                  </button>
                </div>
              )}
              {!calibrated && (
                <button
                  type="button"
                  className="text-xs text-stone-500 underline"
                  onClick={() => {
                    cancelCalibration();
                    setDeferredSource(background.imageDataUrl);
                  }}
                >
                  稍后再校准
                </button>
              )}
            </section>
          ) : (
            <p className="rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-500">
              先上传户型图，再按引导校准尺寸。也可切换到墙工具，从零手动描墙。
            </p>
          )}
          {(uploading || loading) && (
            <p aria-live="polite" className="text-xs text-stone-500">
              {uploading ? '正在处理户型图…' : '正在读取户型图…'}
            </p>
          )}
          {message && (
            <p
              aria-live="polite"
              className="text-xs leading-relaxed text-emerald-800"
            >
              {message}
            </p>
          )}
          <section
            aria-label="项目数据概览"
            className="space-y-2 text-xs text-stone-500"
          >
            <h3 className="font-medium text-stone-700">项目数据</h3>
            <p>
              {project.walls.length} 面墙 · {project.openings.length} 个门窗 ·{' '}
              {project.rooms.length} 个房间 · {project.furniture.length} 件家具
              · {project.anchors.length} 个锚点
            </p>
            <p className="leading-relaxed">
              门窗、房间和家具的绘制工具将在后续版本提供。
            </p>
          </section>
        </aside>
      )}
    </section>
  );
}
