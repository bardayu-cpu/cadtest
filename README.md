# cadtest · 户型图 → 实景效果图

项目目标：上传户型平面图，识别与编辑空间、布置家具、生成彩色平面图和室内全景效果图。

当前仅完成 Issue #1 项目脚手架：首页显示项目空状态，编辑器与分享页为占位页面，四个 API 的 POST 请求返回 `501`。尚未实现项目管理、识别、编辑、渲染或发布功能；本阶段不需要 API Key，也不调用外部 AI 服务。

## 本地运行

需要 Node.js **20.9.0 或更高版本**和 npm。`.nvmrc` 固定本次验证使用的 Node.js 20.11.1；使用 nvm 时可运行 `nvm install && nvm use`。

```bash
npm install
npm run dev
```

浏览器打开 <http://localhost:3000>。页面使用中文，样式由 Tailwind CSS 提供，不需要下载远程字体。

- `/`：项目列表空状态。
- `/project/example`：项目编辑器占位页面。
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

Playwright 冒烟测试覆盖桌面和移动端视口、占位页导航及 API 占位响应：

```bash
npx playwright install chromium
npm run e2e
```

E2E 会自动启动和关闭开发服务器，需要 3000 端口空闲。首次运行需要下载 Chromium；单元测试不包含 E2E 文件。

本机已有 Google Chrome 时，也可使用 `PLAYWRIGHT_CHANNEL=chrome npm run e2e`，无需额外下载 Chromium（macOS / Linux）。

## 目录与规范

`app/`、`src/` 按规格 §4 建好目录；尚未开发的模块使用空导出，空子目录通过 `.gitkeep` 保留。`tests/unit/` 与 `tests/e2e/` 分别放置单元测试和浏览器测试。

TypeScript 使用 strict 模式；纯几何逻辑放在 `src/geometry/` 并配单元测试。数据模型长度统一使用毫米，场景单位换算仅在 `src/geometry/units.ts` 实现。界面文本用中文，代码、标识符和注释用英文。

`.env*`、构建产物、测试报告和依赖目录均已忽略，只有 `.env.example` 可提交。当前不需要任何环境变量；后续服务端配置应只在明确需要的 Issue 中引入。不要提交密钥或添加统计 SDK。

项目按 Issue 推进，每个 Issue 对应一个 PR；分支、PR 格式和完整开发约束见以下文件：

- 完整方案：[`docs/SPEC.md`](docs/SPEC.md)
- 编码代理须知：[`AGENTS.md`](AGENTS.md)
- 决策记录：[`DECISIONS.md`](DECISIONS.md)
- 测试用户型图：`fixtures/`
