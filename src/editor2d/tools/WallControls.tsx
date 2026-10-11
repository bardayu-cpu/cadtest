import type { WallTool } from './useWallTool';
import { wallLength } from '@/geometry/walls';

export function WallControls({ editor }: { editor: WallTool }) {
  const preset =
    editor.thickness === 240 || editor.thickness === 120
      ? String(editor.thickness)
      : 'custom';
  return (
    <section
      aria-label="墙体工具设置"
      className="space-y-3 rounded-lg bg-stone-50 p-3 text-sm"
    >
      <h3 className="font-semibold">墙体工具</h3>
      <p className="text-xs leading-relaxed text-stone-500">
        点击连续描墙，双击或 Esc 结束。默认正交，按 Shift
        自由画线；优先吸附端点和墙线。选择工具可拖动墙或端点，Delete 删除。
      </p>
      <label className="flex items-center justify-between gap-2">
        新墙厚度
        <select
          aria-label="新墙厚度"
          value={preset}
          className="rounded border bg-white p-1"
          onChange={(event) =>
            editor.setThickness(
              event.target.value === 'custom'
                ? 180
                : Number(event.target.value),
            )
          }
        >
          <option value="240">240 mm</option>
          <option value="120">120 mm</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      {preset === 'custom' && (
        <label className="block text-xs">
          自定义墙厚（mm）
          <input
            type="number"
            min="1"
            step="any"
            value={Number.isFinite(editor.thickness) ? editor.thickness : ''}
            onChange={(event) =>
              editor.setThickness(event.currentTarget.valueAsNumber)
            }
            className="mt-1 w-full rounded border bg-white p-2"
          />
        </label>
      )}
      {editor.tool === 'wall' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            editor.commitLength();
          }}
          className="space-y-2"
        >
          <label className="block text-xs">
            下一段长度（mm）
            <input
              aria-label="下一段长度（mm）"
              type="number"
              min="0.001"
              step="any"
              disabled={!editor.start}
              placeholder="也可在画布上直接键入"
              value={editor.lengthInput}
              onChange={(event) => editor.setLengthInput(event.target.value)}
              className="mt-1 w-full rounded border bg-white p-2 disabled:opacity-40"
            />
          </label>
          <button
            type="submit"
            disabled={!editor.start}
            className="w-full rounded border bg-white p-2 disabled:opacity-40"
          >
            按长度画下一段
          </button>
          <button
            type="button"
            onClick={editor.finish}
            className="text-xs text-emerald-800 underline"
          >
            结束描墙
          </button>
        </form>
      )}
      {editor.selected && (
        <div className="space-y-2 border-t pt-3" aria-label="已选墙体">
          <p>已选墙体 · {wallLength(editor.selected).toFixed(1)} mm</p>
          <label className="block text-xs">
            已选墙厚（mm）
            <input
              key={`${editor.selected.id}:${editor.selected.thickness}`}
              type="number"
              min="1"
              step="any"
              defaultValue={editor.selected.thickness}
              onBlur={(event) =>
                editor.changeSelectedThickness(
                  event.currentTarget.valueAsNumber,
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="mt-1 w-full rounded border bg-white p-2"
            />
          </label>
          <button
            type="button"
            className="text-red-700 underline"
            onClick={editor.removeSelected}
          >
            删除选中墙体
          </button>
        </div>
      )}
      <p className="text-xs text-stone-500">
        绿色：手动画墙 · 蓝色：自动识别 · 橙色：低置信度
      </p>
      {editor.error && (
        <p role="alert" className="text-xs text-red-700">
          {editor.error}
        </p>
      )}
    </section>
  );
}
