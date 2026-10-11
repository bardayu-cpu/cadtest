'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { Project, Vec2 } from '@/model/types';
import { useProjectStore } from '@/model/provider';
import { calibrationScale, pointDistance } from '@/geometry/canvas';
import { pxToMm } from '@/geometry/units';
import { Canvas2D } from './Canvas2D';
import { loadImage, sanitizeFloorPlan } from './image';

export function EditorCanvas({
  background,
}: {
  background: Project['background'];
}) {
  const updateBackground = useProjectStore((state) => state.updateBackground);
  const [loaded, setLoaded] = useState<{
    source: string;
    image?: HTMLImageElement;
    error?: string;
  } | null>(null);
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    source: string;
    points: Vec2[];
  } | null>(null);
  const calibrating = selection?.source === background.imageDataUrl;
  const points = calibrating && selection ? selection.points : [];
  const uploadRequest = useRef(0);
  const image =
    loaded?.source === background.imageDataUrl ? loaded.image : undefined;
  const imageError =
    loaded?.source === background.imageDataUrl ? loaded.error : undefined;
  const loading = Boolean(background.imageDataUrl && !image && !imageError);
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

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const request = ++uploadRequest.current;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const imageDataUrl = await sanitizeFloorPlan(file);
      if (request !== uploadRequest.current) return;
      updateBackground({ imageDataUrl, mmPerPixel: 1, offset: { x: 0, y: 0 } });
      setVisible(true);
      setSelection(null);
      setMessage('上传完成，请先手动校准比例尺。');
    } catch (error) {
      if (request === uploadRequest.current)
        setError(
          error instanceof Error ? error.message : '图片处理失败，请重新上传。',
        );
    } finally {
      if (request === uploadRequest.current) setUploading(false);
    }
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
  function cancelCalibration() {
    setSelection(null);
    setError(null);
  }
  const canCalibrate = Boolean(
    image && visible && background.opacity > 0 && !uploading,
  );

  return (
    <section
      aria-label="编辑画布"
      className="space-y-5 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancelCalibration();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">户型图编辑</h2>
          <p className="mt-1 text-sm text-stone-600">
            上传底图，校准比例尺后开始规划空间。
          </p>
        </div>
        <label className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
          上传户型图
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={upload}
            className="mt-2 block min-w-0 max-w-full text-sm"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
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
        <label className="flex items-center gap-3">
          底图透明度
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={background.opacity}
            disabled={!image || uploading}
            onChange={(event) =>
              updateBackground({ opacity: Number(event.currentTarget.value) })
            }
          />
          <span className="w-10 tabular-nums">
            {Math.round(background.opacity * 100)}%
          </span>
        </label>
        <button
          type="button"
          disabled={!canCalibrate}
          className="rounded-lg bg-emerald-800 px-4 py-2 text-white disabled:opacity-40"
          onClick={() => {
            setSelection({ source: background.imageDataUrl, points: [] });
            setError(null);
            setMessage(null);
          }}
        >
          手动校准
        </button>
        <span className="tabular-nums text-stone-600">
          比例尺：1 px = {background.mmPerPixel.toFixed(6)} mm
        </span>
      </div>
      <p className="text-xs text-stone-500">
        支持 JPG / PNG / WebP，最大 20
        MB。图片仅保存在当前浏览器，上传时会去除原图的 EXIF 信息。
      </p>
      {(uploading || loading) && (
        <p aria-live="polite" className="text-sm text-stone-600">
          {uploading ? '正在处理户型图…' : '正在读取户型图…'}
        </p>
      )}
      {(error || imageError) && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error || imageError}
        </p>
      )}
      {message && (
        <p
          aria-live="polite"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {message}
        </p>
      )}
      {calibrating && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            {points.length < 2
              ? `在尺寸线两端点击，选择第 ${points.length + 1} 个点。按 Esc 取消。`
              : '输入这两个点之间的真实距离，单位为毫米。重新校准只改变底图比例尺。'}
          </p>
          {points.length === 2 && (
            <form
              onSubmit={calibrate}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="flex flex-col gap-2 text-sm">
                真实距离（mm）
                <input
                  name="distance"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="例如 15040"
                  className="w-48 rounded-lg border border-amber-300 bg-white px-3 py-2"
                  required
                />
              </label>
              <button
                type="submit"
                className="rounded-lg bg-emerald-800 px-4 py-2 text-sm text-white"
              >
                应用校准
              </button>
              <span
                aria-label="当前两点距离"
                className="py-2 text-sm tabular-nums"
              >
                当前两点距离：
                {pxToMm(
                  pointDistance(points[0], points[1]),
                  background.mmPerPixel,
                ).toFixed(2)}{' '}
                mm
              </span>
            </form>
          )}
          <div className="flex gap-5 text-sm">
            <button
              type="button"
              className="text-amber-950 underline"
              onClick={() => {
                setSelection({ source: background.imageDataUrl, points: [] });
                setError(null);
              }}
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
        </div>
      )}
      <Canvas2D
        background={background}
        image={image}
        visible={visible}
        selecting={canCalibrate && calibrating && points.length < 2}
        points={points}
        onPick={(point) =>
          setSelection((current) =>
            current?.source === background.imageDataUrl &&
            current.points.length < 2
              ? { ...current, points: [...current.points, point] }
              : current,
          )
        }
      />
    </section>
  );
}
