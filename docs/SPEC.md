# 户型图 → 实景效果图工具 · 实现方案（第二档：白模 + AI 上色）

> **给 Codex 的说明**
> 这是一份完整的实现规格。请按「第 10 节 · 分阶段里程碑」顺序实现，每个阶段完成后对照验收标准自测，再进入下一阶段。
> 遇到本文未规定的细节，优先选择**更简单、可替换**的做法，并在 `DECISIONS.md` 里记一行说明。
> 「第 12 节 · 待确认决策」中的项目，在动手前先按默认值实现，不要阻塞。

---

## 1. 目标与范围

### 1.1 一句话目标
用户上传一张户型平面图（截图或图片），描出墙体和门窗、摆上家具占位块后，工具自动生成 3D 白模，并调用 AI 图像模型把白模"画"成照片级室内效果图。**空间结构由 3D 白模保证准确，质感由 AI 负责。**

### 1.2 MVP 范围（必须做）
- 上传户型图，设置比例尺，在图上手动描绘墙体、门、窗
- 标注房间（客厅、餐厅、卧室、厨房、卫生间等）
- 从家具库拖放家具占位块（简单几何体，真实尺寸）
- 浏览器内实时预览 3D 白模，可自由漫游、放置相机
- 从相机视角导出结构图：白模渲染图、深度图、线稿图、语义分割图
- 选择风格预设 → 调用 AI 生成效果图
- 同一项目内多个视角的风格保持一致（同一风格描述、同一参考图、固定种子）
- 项目保存 / 打开（本地 JSON 文件）

### 1.3 非目标（MVP 不做）
- 自动识别户型图中的墙体（OCR / CV 识别）→ 第 4 阶段可选
- 读取 .dwg 原生 CAD 文件
- 真实家具三维模型、材质编辑器
- 720° 全景 → 第 3 阶段实验性功能
- 用户账号、云端存储、多人协作

---

## 2. 用户流程

```
① 新建项目，上传户型图
② 比例尺校准：点击图上两个点，输入两点之间的真实距离（mm）
   例：点图上标注 "15040" 那条尺寸线的两端，输入 15040
③ 描墙：沿墙体中心线点击连续折线，双击结束；可设置墙厚（默认 240mm，内墙 120mm）
④ 放门窗：在墙段上点击放置，设置宽度、类型（门 / 窗 / 推拉门 / 门洞）
⑤ 标房间：在封闭区域内点击，选择房间类型
⑥ 摆家具：从侧栏拖家具块到平面上，可旋转、调尺寸
⑦ 切到 3D 视图：检查白模，漫游，放置相机（多个视角）
⑧ 选风格预设（可上传一张参考图，例如喜欢的效果图）
⑨ 对每个相机点"生成"，查看结果，满意的标记为"定稿"
⑩ 导出全部效果图（PNG）+ 项目文件（JSON）
```

---

## 3. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript | 前后端一体，API Key 只放服务端 |
| 2D 编辑器 | Konva.js（react-konva） | 画布、拖拽、吸附 |
| 3D | Three.js + @react-three/fiber + @react-three/drei | 白模生成、相机、结构图导出 |
| 状态管理 | Zustand | 项目数据单一来源 |
| 样式 | Tailwind CSS | |
| 校验 | Zod | 项目 JSON 读写校验 |
| 本地存储 | IndexedDB（idb-keyval）+ 导出 JSON 文件 | 不需要数据库 |
| AI 渲染 | 服务端 Provider 适配层（见 6.4） | 可替换不同模型服务 |
| 测试 | Vitest（几何逻辑单测）+ Playwright（主流程冒烟） | |

---

## 4. 目录结构

```
/app
  /page.tsx                 项目列表 / 新建
  /project/[id]/page.tsx    主编辑器（2D / 3D / 渲染 三个标签页）
  /api/render/route.ts      AI 渲染接口（服务端调用模型）
/src
  /model
    types.ts                数据模型（见第 5 节）
    schema.ts               Zod 校验
    store.ts                Zustand store
  /editor2d
    Canvas2D.tsx
    tools/                  calibrate / wall / opening / room / furniture / select
    snapping.ts             端点吸附、正交锁定、墙线吸附
  /geometry
    walls.ts                墙段 → 带洞口的墙体网格
    rooms.ts                房间多边形 → 地面 / 天花板
    units.ts                mm ↔ 场景单位（1 单位 = 1 米）
  /scene3d
    Scene3D.tsx
    buildScene.ts           项目数据 → Three.js 场景
    cameras.ts              相机点管理
    passes/                 white / depth / lineart / segmentation 导出
  /render
    providers/
      types.ts              RenderProvider 接口
      mock.ts               返回结构图本身，开发用
      <provider>.ts         真实模型适配器
    promptBuilder.ts        风格预设 + 房间信息 → 提示词
    stylePresets.ts
  /furniture
    catalog.ts              家具库（尺寸、类别、分割色）
/tests
DECISIONS.md
```

---

## 5. 数据模型

```ts
// 所有长度单位：毫米（mm）；坐标原点为户型图左上角校准后的位置
type Vec2 = { x: number; y: number };

interface Project {
  id: string;
  name: string;
  version: 1;
  background: {
    imageDataUrl: string;          // 上传的户型图
    mmPerPixel: number;            // 比例尺校准结果
    offset: Vec2;
    opacity: number;
  };
  settings: {
    wallHeight: number;            // 默认 2800
    defaultWallThickness: number;  // 默认 240
  };
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
  cameras: CameraShot[];
  style: StyleConfig;
  renders: RenderResult[];
}

interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  height?: number;                 // 覆盖全局层高
}

interface Opening {
  id: string;
  wallId: string;
  offset: number;                  // 洞口中心距墙段起点的距离
  width: number;
  kind: 'door' | 'window' | 'sliding_door' | 'opening' | 'floor_window';
  sillHeight: number;              // 门 = 0，窗默认 900，落地窗 = 0
  headHeight: number;              // 门默认 2100，窗默认 2400
}

type RoomType = 'living' | 'dining' | 'bedroom' | 'master_bedroom' | 'kitchen'
  | 'bathroom' | 'study' | 'balcony' | 'entrance' | 'corridor';

interface Room {
  id: string;
  type: RoomType;
  name: string;                    // 显示名，例如「主卧」
  polygon: Vec2[];                 // 房间内轮廓
  ceilingStyle: 'flat' | 'cove_light' | 'drop_edge';  // 平顶 / 灯带 / 边吊
  floorMaterialHint: string;       // 例如 'herringbone_wood'
}

interface FurnitureItem {
  id: string;
  catalogId: string;               // 指向 catalog.ts
  position: Vec2;                  // 中心点
  rotation: number;                // 角度，0/90/180/270 吸附，按住 Shift 自由旋转
  size: { w: number; d: number; h: number };
  elevation: number;               // 离地高度，吊柜等使用
}

interface CameraShot {
  id: string;
  name: string;                    // 例如「客厅看电视墙」
  roomId: string;
  position: { x: number; y: number; z: number };   // mm，z 为高度，默认 1400
  target: { x: number; y: number; z: number };
  fov: number;                     // 默认 70°（室内广角）
  aspect: '16:9' | '4:3' | '3:4' | '1:1';
}

interface StyleConfig {
  presetId: string;
  referenceImageDataUrl?: string;  // 用户上传的风格参考图
  extraPrompt?: string;
  seed: number;                    // 项目级固定种子，保证一致性
}

interface RenderResult {
  id: string;
  cameraId: string;
  createdAt: string;
  imageDataUrl: string;
  provider: string;
  params: Record<string, unknown>;
  approved: boolean;               // 定稿
}
```

---

## 6. 模块详细说明

### 6.1 2D 户型编辑器

**比例尺校准（第一步，强制）**
- 用户在图上点两个点，弹窗输入实际距离（mm），计算 `mmPerPixel`
- 校准后，画布上所有输入和显示都以 mm 为单位
- 支持重新校准，已画的几何体保持 mm 坐标不变

**描墙工具**
- 点击连续画折线，双击或按 Esc 结束
- 吸附规则（按优先级）：已有墙端点（10px 内）→ 已有墙线 → 正交锁定（0°/90°，按住 Shift 解除）
- 画线时实时显示长度（mm），可直接键盘输入数值确定长度
- 墙与墙的连接处自动处理成 L 形 / T 形接头（在 3D 生成阶段处理，2D 只需端点重合）

**门窗工具**
- 鼠标悬停在墙上时显示预览，点击放置
- 属性面板可编辑：类型、宽度、离地高度、顶高
- 校验：洞口不能超出墙段，同一墙上洞口不能重叠

**房间工具**
- 在由墙围成的封闭区域内点击 → 自动计算房间多边形（基于墙体中心线构建平面图，查找包含点击点的最小环）
- 自动识别失败时，降级为手动点多边形
- 选择房间类型后，用不同底色区分

**家具工具**
- 侧栏按房间类型分组展示家具库
- 拖到画布上，显示真实尺寸的俯视矩形 + 名称
- 支持旋转、改尺寸、删除、复制

**通用**
- 撤销 / 重做（至少 50 步）
- 户型图透明度调节、隐藏
- 缩放、平移（滚轮 + 空格拖动）

### 6.2 3D 白模生成（`buildScene.ts`）

项目数据 → Three.js 场景，**项目数据变化时增量或整体重建**（MVP 直接整体重建即可，户型规模小）。

**墙体**
- 每段墙 = 沿中心线向两侧各扩展 thickness/2 的长方体
- 洞口处理**不用 CSG**：把墙段沿长度方向切成若干段
  - 洞口左右：完整高度墙块
  - 洞口下方：高度 = sillHeight 的墙块（门为 0，不生成）
  - 洞口上方：从 headHeight 到层高的墙块（过梁）
- 墙角接头：端点重合的墙段，各自延伸 thickness/2 以消除缝隙（MVP 允许轻微重叠）

**地面 / 天花板**
- 每个房间多边形 → `ShapeGeometry`，地面 z=0，天花板 z=层高
- `ceilingStyle = cove_light`：天花板内缩 300mm 生成一圈下沉 100mm 的边吊，并在边缘放置一条细长自发光条（用于模拟灯带的位置，供 AI 参考）

**门窗**
- 门：洞口内放一块薄板（厚 40mm），半开或关闭
- 窗：洞口内放窗框（细长方体）+ 半透明玻璃板
- 不需要精细，只要 AI 能看出"这里是门 / 窗"

**家具**
- 每件家具 = 带尺寸的长方体，或按类别用 2~4 个长方体做粗略造型（例如沙发 = 座面 + 靠背 + 扶手；床 = 床体 + 床头板）
- 在 `catalog.ts` 中为每类家具定义一个 `buildMesh(size)` 函数

**材质**
- 白模预览：统一浅灰 `MeshStandardMaterial`，环境光 + 一盏方向光
- 每个物体的 `userData` 记录类别（wall / floor / ceiling / door / window / sofa / bed / …），供分割图使用

### 6.3 相机与结构图导出（`passes/`）

**相机点**
- 3D 视图中提供"在此处放置相机"：用当前视角保存一个 `CameraShot`
- 也可在 2D 平面上拖一个相机图标 + 朝向箭头
- 默认眼高 1400mm，FOV 70°

**从每个相机点导出四张图（同一分辨率，默认 1344×768 或按比例）**

| 结构图 | 实现 | 用途 |
|---|---|---|
| 白模图 | 正常渲染，浅灰材质 + 柔和光照 | 整体构图参考 |
| 深度图 | 自定义 ShaderMaterial 输出线性深度，按 near/far 归一化，**近处亮、远处暗** | 控制空间纵深（depth 类条件控制） |
| 线稿图 | `EdgesGeometry`（阈值角 30°）渲染边线，**黑底白线** | 控制结构边缘（canny / mlsd 类条件控制） |
| 语义分割图 | 每个类别一个固定纯色，关闭光照（`MeshBasicMaterial`） | 告诉 AI 哪里是墙、地、沙发…… |

- 导出用离屏 `WebGLRenderTarget` 渲染，`readRenderTargetPixels` 转 PNG
- 分割色表固定写在 `catalog.ts`，例如：墙 `#787878`，地面 `#503232`，天花板 `#787850`，窗 `#E6E6E6`，门 `#08FF33`，沙发 `#0B66FF`，床 `#CC05FF`……（如选用的模型有既定色表，以模型要求为准）
- 导出结果在"渲染"标签页中可预览，方便调试

### 6.4 AI 渲染（服务端）

**Provider 接口**

```ts
interface RenderRequest {
  controls: {
    depth?: string;          // base64 PNG
    lineart?: string;
    segmentation?: string;
    white?: string;
  };
  referenceImage?: string;   // 风格参考图
  prompt: string;
  negativePrompt?: string;
  seed: number;
  width: number;
  height: number;
  strength?: number;         // 结构约束强度，0~1
}

interface RenderProvider {
  id: string;
  supports: { depth: boolean; lineart: boolean; segmentation: boolean; reference: boolean };
  render(req: RenderRequest): Promise<{ image: string; meta: Record<string, unknown> }>;
}
```

**要实现的 Provider**
1. `mock`：直接返回白模图并叠加文字"MOCK"。**前两个阶段全程使用它**，不依赖任何外部服务
2. 一个真实 Provider，满足以下能力之一即可（具体服务见第 12 节待确认）：
   - **方案 A：结构条件控制类模型**（支持深度图 / 线稿作为条件输入的扩散模型，可通过托管 API 或自建 ComfyUI 调用）。结构保持最准，推荐优先
   - **方案 B：多图输入的图像编辑模型**（把白模图 + 参考图一起传入，用文字要求"保持结构，按参考图风格渲染成实景照片"）。接入最简单，但结构偏移的风险更大

**服务端要求**
- API Key 只从环境变量读取（`.env.local`），绝不下发到前端，不写入日志
- 单次请求超时 120 秒；失败重试 1 次；返回明确错误信息给前端
- 不在服务端持久化任何图片，处理完即丢弃

**提示词构建（`promptBuilder.ts`）**

```
[风格预设正向描述], [房间类型描述], [该视角可见的主要家具列表],
interior photography, photorealistic, natural light, high detail,
[用户补充描述]
```

- 房间类型和家具列表由相机所在房间 + 视锥内可见物体自动生成
- 负向提示词统一：`cartoon, sketch, distorted perspective, extra furniture, people, text, watermark, low quality`

### 6.5 多视角一致性策略

AI 生成的最大问题是不同视角之间"对不上"，按以下顺序叠加措施：

1. **同一风格描述**：所有视角使用同一套预设 + 同一份材质清单（例如"深棕色皮质沙发、人字拼胡桃木地板、奶油色墙面"）
2. **固定种子**：项目级 `seed`，所有视角共用
3. **参考图锚定**：第一个视角定稿后，自动将其设为后续视角的参考图（可关闭）
4. **语义分割图**：同类物体在所有视角中颜色一致，帮助模型保持材质对应

### 6.6 结果管理
- 每个相机点下保留历史生成结果，可对比、标记定稿
- "导出全部定稿图"：打包为 zip（文件名 = 相机名称）
- 项目文件导出为 `.json`（包含所有数据和图片 base64），可重新导入

---

## 7. 风格预设示例（`stylePresets.ts`）

```ts
export const stylePresets = [
  {
    id: 'cream-walnut',
    name: '奶油原木',
    prompt: 'warm cream-colored walls, herringbone walnut wood floor, dark brown leather sofa, '
      + 'recessed ceiling with hidden warm LED cove lighting, walnut wood cabinetry, '
      + 'round wooden coffee table, soft textured rug, mid-century dining chairs, '
      + 'warm and calm atmosphere, 3000K lighting',
    materials: ['奶油色乳胶漆墙面', '人字拼胡桃木地板', '深棕皮沙发', '胡桃木柜体'],
  },
  { id: 'modern-minimal', name: '现代极简', prompt: '...', materials: [] },
  { id: 'japandi',        name: '日式原木', prompt: '...', materials: [] },
  { id: 'french-vintage', name: '法式复古', prompt: '...', materials: [] },
];
```

MVP 至少完整实现 `cream-walnut`，其余三个可以先填写提示词，不做专门调优。

---

## 8. 家具库（`catalog.ts`）最小集合

| 房间 | 家具（默认尺寸 W×D×H，mm） |
|---|---|
| 客厅 | 三人沙发 2400×900×800、单人椅 800×800×750、圆茶几 Ø900×400、电视柜 2400×400×450、电视 1450×60×830（离地 900）、地毯 2400×1700×10 |
| 餐厅 | 圆餐桌 Ø1200×750、长餐桌 1600×900×750、餐椅 500×500×800、餐边柜 1600×450×900 |
| 卧室 | 双人床 1800×2100×1000、单人床 1200×2000×900、床头柜 500×400×500、衣柜 2000×600×2400 |
| 书房 | 书桌 1400×700×750、书柜 1200×350×2000、办公椅 600×600×1000 |
| 厨房 | 地柜 600 深×850 高（按长度拉伸）、吊柜 350 深×700 高（离地 1500）、冰箱 700×700×1800 |
| 卫生间 | 马桶 400×700×750、浴室柜 800×500×850、淋浴区 900×900×10 |
| 通用 | 绿植 Ø500×1200、落地灯 Ø400×1600、装饰画 800×30×1000（贴墙，离地 1200） |

---

## 9. 隐私与安全

- **默认本地优先**：户型图、项目数据只存在用户浏览器（IndexedDB）和用户自己导出的文件里
- **上传前提示**：首次调用真实 Provider 时弹出提示："结构图将发送至第三方 AI 服务进行处理"，用户确认后才发送。只发送结构图，**不发送原始户型图**
- **元数据清理**：上传的户型图在读取时用 canvas 重绘，去掉 EXIF 信息
- **遮挡工具**：2D 编辑器提供矩形遮挡工具，可盖住户型图上的楼盘名、楼栋号等文字（遮挡只影响显示，不影响已画几何体）
- API Key 只在服务端环境变量中，`.env.local` 必须在 `.gitignore` 里
- 不接入任何统计 / 埋点 SDK

---

## 10. 分阶段里程碑

### 阶段 1：2D 编辑器 + 数据模型（使用 mock，不接 AI）
- 实现：项目新建 / 保存 / 打开，上传户型图，比例尺校准，描墙，门窗，房间，家具，撤销重做
- **验收**：
  - 用一张真实户型图，校准后描出所有外墙，任意一段墙的显示长度与图上标注误差 < 1%
  - 门窗不能超出墙段，重叠时给出提示
  - 刷新页面后项目完整恢复；导出 JSON 再导入，数据完全一致
  - Vitest 覆盖：比例尺换算、吸附、洞口校验、房间多边形查找

### 阶段 2：3D 白模 + 结构图导出（仍使用 mock）
- 实现：buildScene，3D 漫游，相机点管理，四种结构图导出
- **验收**：
  - 门窗洞口正确，墙角无明显缝隙
  - 2D 修改后切到 3D，白模同步更新
  - 从同一相机点导出的四张图像素级对齐（叠加检查）
  - 深度图近亮远暗，分割图颜色与色表完全一致（无抗锯齿混色：分割 pass 关闭抗锯齿）

### 阶段 3：接入真实 AI 渲染
- 实现：一个真实 Provider、提示词构建、风格预设、一致性策略、结果管理与导出、隐私确认弹窗
- **验收**：
  - 客厅、餐厅、主卧各一个视角，生成结果中墙体、门窗位置与白模一致
  - 同一项目三个视角的地板、墙面颜色、沙发材质肉眼看属于同一套装修
  - 服务端日志中搜不到 API Key 和图片内容
  - Provider 报错时，前端显示可理解的错误信息，不白屏

### 阶段 4（可选）：增强
- **720° 全景（实验性）**：用 `CubeCamera` 渲染六面结构图 → 逐面 AI 生成（共享种子和参考图）→ 拼接为等距柱状投影图 → 用 Three.js 球面查看器浏览。已知风险：面与面之间有接缝，需评估是否可接受
- **户型图自动识别**：用图像处理（二值化 + 霍夫直线检测）预识别墙线，作为描墙的初稿，由用户修正
- **局部重绘**：在效果图上框选区域，只重新生成该区域（例如换沙发颜色）

---

## 11. 风险与已知局限

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI 不严格遵守结构 | 门窗位置偏移、多出家具 | 优先用结构条件控制类模型；调高约束强度；分割图 + 线稿叠加 |
| 多视角不一致 | 同一沙发在不同图里颜色不同 | 6.5 节的四项措施；接受"风格一致、细节有差异"作为 MVP 标准 |
| 房间自动闭合失败 | 用户无法标注房间 | 降级为手动画多边形 |
| 户型图不清晰 / 无尺寸 | 比例尺无法校准 | 允许用户输入任意一面墙的已知长度 |
| AI 服务成本 | 反复生成费用累积 | 显示每次调用的预估成本；mock 模式用于调试 |

---

## 12. 待确认决策（先按默认值实现）

| 决策 | 默认值 | 备注 |
|---|---|---|
| 真实 AI Provider 选哪家 | 先只实现 mock；阶段 3 前由我确认 | 需要核实当前哪些服务支持深度图 / 线稿条件输入、价格、国内访问情况 |
| 部署方式 | 本地运行（`npm run dev`） | 暂不部署公网 |
| 界面语言 | 中文 | 代码、注释用英文 |
| 默认输出分辨率 | 长边 1344px | 取决于所选模型的推荐尺寸 |
| 是否需要移动端 | 不需要，桌面浏览器即可 | |
