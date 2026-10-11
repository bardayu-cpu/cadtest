# cadtest · 户型图 → 实景效果图

项目目标：上传户型平面图，识别与编辑空间、布置家具、生成彩色平面图和室内全景效果图。

当前完成脚手架及 Issue #2 数据模型：可以新建、打开、删除本地项目，自动保存、导入导出 JSON，以及撤销重做项目修改。画布、识别、家具布置、渲染和发布仍留给后续 Issue；四个 API 的 POST 返回 `501`。本阶段不需要 API Key，也不调用外部 AI 服务。

## 本地运行

推荐使用 **Node.js 24 LTS** 和 npm；`.nvmrc` 指定大版本 `24`，本地和 CI 使用同一版本线。测试工具的 Node 22 最低要求为 **22.12.0**，完整支持范围见 `package.json` 的 `engines.node`。使用 nvm 时先运行：

```bash
nvm install
nvm use
```

```bash
npm install
npm run dev
```

浏览器打开 <http://localhost:3000>。页面使用中文，样式由 Tailwind CSS 提供，不需要下载远程字体。

- `/`：本地项目列表，可新建、打开、删除、导入和导出项目。
- `/project/[id]`：已创建项目的信息页，可修改名称、撤销重做和导出 JSON；不存在的编号会显示中文提示。
- `/s/example`：全景查看占位页面。

生产构建与运行：

```bash
npm run build
npm start
```

## 开发检查

```bash
npm run lint       # ESLint 和 Prettier 格式检查
npm run typecheck  # 生成 Next.js 路由类型，然后检查 TypeScript strict
npm test           # Vitest 单元测试，不进入监听模式
```

`npm run format` 格式化代码，`npm run test:watch` 启动单元测试监听。GitHub Actions 在 push 和 PR 时使用 `npm ci` 安装锁定依赖，并运行上述三项检查。

Playwright 测试覆盖桌面和移动端视口的项目管理、刷新恢复、完整 JSON 导入导出、无效文件提示、撤销重做快捷键，以及 API 占位响应：

```bash
npx playwright install chromium
npm run e2e
```

E2E 会自动启动和关闭开发服务器，需要 3000 端口空闲。首次运行需要下载 Chromium；单元测试不包含 E2E 文件。

本机已有 Google Chrome 时，也可使用 `PLAYWRIGHT_CHANNEL=chrome npm run e2e`，无需额外下载 Chromium（macOS / Linux）。

## 项目数据与本地保存

项目只保存在当前浏览器的 IndexedDB，不上传到服务器；不同浏览器或设备不会自动同步。清理浏览器数据会删除本地项目，请通过「导出 JSON」保存备份。

- 从首页输入名称并新建项目，或选择 `.json` 文件导入。文件经过 Zod 校验，格式、版本、字段或引用不存在会显示带字段位置的中文提示，不影响已有项目；同编号项目需要确认才能覆盖。导入保留原编号及全部数据。
- 项目信息页支持修改名称，提供撤销、重做按钮和 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 快捷键；输入框内保留原生文字撤销。
- 修改停止 400ms 后自动保存最后一次修改，页面显示读取、保存、完成或失败状态。页面隐藏、pagehide 或离开编辑页时立即发起保存；浏览器强制退出仍可能中止异步写入。索引或项目读取失败时禁用相应编辑，避免覆盖已有数据；保存失败保留当前修改，可以重试或导出备份。
- 编辑历史使用完整项目快照，保留最近 100 步；打开不同项目、离开项目页、导入或刷新页面会清空历史。项目新建、删除和导入不属于编辑撤销操作，删除与导入覆盖需确认。

`src/model/types.ts` 和 `schema.ts` 覆盖规格 §5 的所有字段，包括后续阶段使用的锚点、全景、识别报告和发布数据。`createProjectStore()` 提供独立 Zustand store，`ProjectProvider` 在浏览器挂载后读取存储，不在服务端共享用户状态。

Store 的 `add/update/removeWall`、`Opening`、`Room`、`Furniture`、`Anchor` action 操作当前项目；手动 update 自动将元素 source 改为 manual。删除墙体同时删除其门窗，删除锚点同时清理相关热点和全景；删除房间还会删除该房间的锚点及其热点和全景引用，并移除家具的 roomId（家具保留）。这些修改均作为一步撤销。`updateProject` 修改项目元数据；元素必须通过对应 action 修改。IndexedDB 每个项目保存为 `project:<id>`，`project-index-v2` 索引只含编号、名称和更新时间；首页读取索引，打开项目或从首页导出时才读取完整内容。项目记录与索引在同一事务更新；保存串行执行，`flush()` 立即发起待写操作并可等待保存结束，失败操作保留供重试。旧 `projects-v2` 键不迁移；图片独立 Blob 存储留到 P6。多标签页编辑同一项目暂以最后写入为准。

## 目录与规范

`app/`、`src/` 按规格 §4 建好目录；尚未开发的模块使用空导出，空子目录通过 `.gitkeep` 保留。`tests/unit/` 与 `tests/e2e/` 分别放置单元测试和浏览器测试。

TypeScript 使用 strict 模式；纯几何逻辑放在 `src/geometry/` 并配单元测试。数据模型长度统一使用毫米，场景单位换算仅在 `src/geometry/units.ts` 实现。界面文本用中文，代码、标识符和注释用英文。

`.env*`、构建产物、测试报告和依赖目录均已忽略，只有 `.env.example` 可提交。当前不需要任何环境变量；后续服务端配置应只在明确需要的 Issue 中引入。不要提交密钥或添加统计 SDK。

项目按 Issue 推进，每个 Issue 对应一个 PR；分支、PR 格式和完整开发约束见以下文件：

- 完整方案：[`docs/SPEC.md`](docs/SPEC.md)
- 编码代理须知：[`AGENTS.md`](AGENTS.md)
- 决策记录：[`DECISIONS.md`](DECISIONS.md)
- 测试用户型图：`fixtures/`
