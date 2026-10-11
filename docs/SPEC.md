# 户型图 → 720° 全景效果图工具 · 实现方案 v2

> **给编码代理的说明**
> 这是完整的实现规格。开发按 GitHub Issue 推进，每个 Issue 只做它自己的范围。
> 遇到本文未规定的细节，优先选择**更简单、可替换**的做法，并在 `DECISIONS.md` 里记一行。
> 「§16 待确认决策」中的项目按默认值实现，不要阻塞。

---

## 1. 目标

### 1.1 一句话目标
用户上传户型平面图 → 系统**自动识别**并建出 3D 白模 → **自动布置家具**（可按需求重新生成）→ 用户选风格或输入关键词，先生成**彩色平面图**确认 → 确认后渲染每个房间的 **720° 全景图** → 生成**分享链接**，朋友在手机上打开即可转动查看，并通过锚点在房间之间跳转。

**核心原则**：空间结构由 3D 白模保证准确，质感交给 AI；每一步自动生成的结果都可以手动微调。

### 1.2 用户流程

```
① 上传户型图
② 自动识别：比例尺、墙体、门窗、房间 → 生成可编辑的户型数据        [可手动修正]
③ 自动布置家具：
     a. 默认：按房间类型 + 户型图上已画的家具符号自动布置
     b. 按需求：输入"两人住，需要书房，客厅要大沙发"等，重新生成布置     [可手动微调]
④ 选风格预设，或输入风格关键词（可上传参考图）
⑤ 生成彩色平面图（俯视效果图）→ 用户确认配色与布局；不满意可调整关键词重来
⑥ 设置全景锚点：系统默认每个房间一个，用户可增删、拖动位置
⑦ 渲染每个锚点的 720° 全景图
⑧ 发布：生成分享链接 → 手机打开，转动查看，点击锚点跳转到其他房间
```

### 1.3 设备分工
- **编辑端**（①–⑦）：桌面浏览器
- **查看端**（⑧）：手机浏览器优先（含微信内置浏览器），桌面也可以看
- 查看端**只看不走**：固定点位的 720° 全景 + 锚点跳转，不做自由漫游

### 1.4 非目标
- 照片级的自由漫游 3D
- 读取 .dwg 原生 CAD 文件（只处理图片 / 截图）
- 真实家具三维模型库、材质编辑器
- 手机端编辑
- 用户账号体系（分享链接即权限）

---

## 2. 系统架构

```
┌──────────── 编辑端（Next.js 页面，桌面）────────────┐
│ 上传 → 识别 → 2D 编辑器 → 家具布置 → 风格 → 彩平图     │
│        → 锚点 → 全景渲染 → 发布                         │
└──────────────┬────────────────────────────────────┘
               │ 服务端 API（Next.js Route Handlers）
   ┌───────────┼────────────────┬─────────────────┐
   ▼           ▼                ▼                 ▼
 户型识别    布置生成         图像生成           发布存储
(CV + 视觉  (规则引擎 +      (彩平图 / 全景，    (对象存储 +
  模型)      LLM 解析需求)    Provider 适配层)    分享数据)
                                                  │
                         ┌────────────────────────┘
                         ▼
           查看端：/s/[shareId]（手机优先的全景查看页）
```

---

## 3. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript strict | 前后端一体，API Key 只放服务端 |
| 2D 编辑器 | Konva.js（react-konva） | |
| 3D | Three.js + @react-three/fiber + drei | 白模、结构图、全景结构图导出 |
| 户型识别 | OpenCV（opencv.js 或服务端 Python 微服务，见 §16）+ 视觉模型兜底 | |
| 全景查看 | Three.js 球面贴图 或 Photo Sphere Viewer（含 Markers 插件） | 必须支持手机陀螺仪、触摸拖动 |
| 状态 | Zustand；校验 Zod | |
| 本地存储 | IndexedDB（idb-keyval） | 编辑中的项目 |
| 发布存储 | 对象存储（S3 兼容）+ 一份分享 JSON | 见 §11 |
| 部署 | Vercel 或同类平台（见 §16） | |
| 测试 | Vitest + Playwright（含移动端视口） | |

---

## 4. 目录结构

```
/app
  /page.tsx                     项目列表
  /project/[id]/page.tsx        编辑器（步骤式：识别 / 编辑 / 家具 / 风格 / 锚点 / 渲染 / 发布）
  /s/[shareId]/page.tsx         手机查看页（公开）
  /api/recognize/route.ts       户型识别
  /api/layout/route.ts          家具布置（按需求）
  /api/render/route.ts          图像生成（彩平图、全景）
  /api/publish/route.ts         发布 / 撤销分享
/src
  /model        types.ts, schema.ts, store.ts
  /editor2d     Canvas2D.tsx, tools/, snapping.ts
  /recognize    pipeline.ts, walls.ts, openings.ts, rooms.ts, scale.ts, symbols.ts
  /layout       rules/, fromSymbols.ts, fromRequirements.ts, validate.ts
  /geometry     walls.ts, rooms.ts, units.ts
  /scene3d      buildScene.ts, passes/, panorama.ts, topView.ts
  /render       providers/, promptBuilder.ts, stylePresets.ts
  /furniture    catalog.ts
  /viewer       PanoramaViewer.tsx, hotspots.ts
  /publish      storage.ts, shareSchema.ts
/tests
DECISIONS.md
```

---

## 5. 数据模型

所有长度单位为毫米（mm）。Three.js 场景中 1 单位 = 1 米，只在 `src/geometry/units.ts` 中换算。

```ts
type Vec2 = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };
type Source = 'auto' | 'manual';         // 记录每个元素是自动生成还是手动添加/修改

interface Project {
  id: string;
  name: string;
  version: 2;
  background: {
    imageDataUrl: string;
    mmPerPixel: number;
    offset: Vec2;
    opacity: number;
  };
  settings: { wallHeight: number; defaultWallThickness: number };  // 默认 2800 / 240
  recognition?: RecognitionReport;      // 最近一次识别的结果与置信度
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
  requirements?: string;                // 用户输入的布置需求原文
  style: StyleConfig;
  floorPlanRenders: ImageResult[];      // 彩色平面图历史
  approvedFloorPlanId?: string;         // 已确认的彩平图
  anchors: Anchor[];
  panoramas: PanoramaResult[];
  publish?: { shareId: string; publishedAt: string; revoked: boolean };
}

interface Wall     { id: string; start: Vec2; end: Vec2; thickness: number; height?: number; source: Source; confidence?: number }
interface Opening  { id: string; wallId: string; offset: number; width: number;
                     kind: 'door' | 'window' | 'sliding_door' | 'opening' | 'floor_window';
                     sillHeight: number; headHeight: number; source: Source; confidence?: number }

type RoomType = 'living' | 'dining' | 'bedroom' | 'master_bedroom' | 'kitchen'
  | 'bathroom' | 'study' | 'balcony' | 'entrance' | 'corridor' | 'other';

interface Room     { id: string; type: RoomType; name: string; polygon: Vec2[];
                     ceilingStyle: 'flat' | 'cove_light' | 'drop_edge'; source: Source }

interface FurnitureItem { id: string; catalogId: string; position: Vec2; rotation: number;
                          size: { w: number; d: number; h: number }; elevation: number;
                          roomId?: string; source: Source }

interface StyleConfig {
  presetId?: string;
  keywords?: string;                    // 用户输入的风格关键词
  referenceImageDataUrl?: string;
  seed: number;                         // 项目级固定种子
  materialPalette?: string[];           // 彩平图确认后锁定的材质清单，供全景沿用
}

interface Anchor {
  id: string;
  name: string;                         // 例如「客厅」「主卧」
  roomId: string;
  position: Vec3;                       // 默认：房间可行走区域中心，z = 1400
  initialHeading: number;               // 打开时的默认朝向（度）
  links: AnchorLink[];                  // 指向其他锚点的跳转热点
  source: Source;
}

interface AnchorLink {
  targetAnchorId: string;
  yaw: number;                          // 热点在本全景中的水平角（度）
  pitch: number;                        // 垂直角，默认 -10（略低于视平线）
  label: string;                        // 显示文字，例如「主卧」
}

interface ImageResult    { id: string; createdAt: string; imageDataUrl: string; provider: string; params: Record<string, unknown> }
interface PanoramaResult extends ImageResult { anchorId: string; approved: boolean }  // 等距柱状投影，宽:高 = 2:1

interface RecognitionReport {
  createdAt: string;
  method: 'cv' | 'vision_model' | 'cv+vision_model';
  scaleDetected: boolean;
  warnings: string[];                   // 例如「左下角两段墙未闭合」
}
```

---

## 6. 户型识别（`src/recognize`）

**目标**：输出与手动绘制相同格式的 `walls / openings / rooms`，并附置信度；结果直接进入 2D 编辑器供修正。识别**不追求 100% 准确**，追求"修正工作量小"。

### 6.1 管线
1. **预处理**：灰度、二值化；针对深色底 CAD 截图自动反色；去除小噪点
2. **比例尺**：
   - 识别外圈尺寸标注的数字（OCR，如 tesseract.js）与对应尺寸线的像素长度 → 计算 `mmPerPixel`
   - 多条尺寸线交叉验证，偏差 > 2% 时给出警告
   - 识别失败 → 回退到手动校准（点两个点、输入距离）
3. **墙体**：
   - 墙在 CAD 图中通常是两条平行线（双线墙）。检测近似平行、间距 80–300mm 的线对 → 取中线为墙中心线、间距为墙厚
   - 过滤：尺寸线（带端部短划线、平行于图边、位于外圈）、家具符号、填充图案
   - 合并共线短段、端点吸附闭合、正交化（角度在 ±3° 内的吸成 0°/90°）
4. **门窗**：
   - 门：墙体缺口 + 附近 1/4 圆弧 → 门；缺口无弧 → 门洞
   - 窗：墙体内的三线或四线平行段 → 窗；宽度占整面外墙且贴近外圈 → 落地窗 / 推拉门
5. **房间**：由墙中心线构建平面图，求所有最小闭合环 → 房间多边形；根据面积、洁具 / 灶台 / 床等符号推断房间类型，无法判断的标为 `other`
6. **家具符号**（供 §7 使用）：检测常见符号（床、沙发、餐桌椅、马桶、洗手盆、灶台、衣柜交叉线），输出 `{类别, 包围盒, 朝向}`

### 6.2 视觉模型兜底（可选，见 §16）
CV 管线结果置信度低时（例如闭合房间数 < 预期、大量孤立线段），把图片发送给支持图像理解的大模型，要求按 Zod schema 输出结构化 JSON，再与 CV 结果合并。**发送前需征得用户同意**（§12）。

### 6.3 结果呈现
- 识别完成后进入编辑器：自动识别的元素用一种颜色显示，低置信度元素用警告色高亮
- 顶部显示 `warnings` 列表，点击可定位到问题处
- "重新识别"按钮：会覆盖所有 `source: 'auto'` 的元素，保留 `manual` 的元素（覆盖前二次确认）

### 6.4 编辑器（修正工具，也可用于从零手动绘制）
自动识别和自动布置的结果都在这里修正，所以编辑器是 P1 的重点。

- **比例尺校准**：点两个点，输入真实距离（mm）→ 计算 `mmPerPixel`；重新校准时已有几何体的 mm 坐标不变
- **描墙**：点击连续画折线，双击或 Esc 结束；墙厚 240 / 120 / 自定义；显示 mm 长度，可键盘输入长度；吸附优先级：已有端点（10px 内）> 已有墙线 > 正交锁定（Shift 解除）；可拖动端点、删除
- **门窗**：门 / 窗 / 推拉门 / 门洞 / 落地窗，悬停墙体预览、点击放置；默认值：门宽 900、sill 0、head 2100；窗宽 1500、sill 900、head 2400；校验不越界、不重叠、head ≤ 墙高；删墙时删除其上洞口
- **房间**：点击封闭区域自动求多边形，失败时手动描多边形；设置类型、名称、吊顶样式；显示面积
- **家具**：侧栏按房间分组拖放；俯视矩形 / 圆形 + 名称；拖动、旋转（90° 吸附，Shift 自由）、改尺寸、复制、删除
- **锚点**（P4 起）：拖动、增删、设置名称与默认朝向
- **通用**：滚轮缩放、空格拖动平移；户型图透明度 / 隐藏；撤销重做 ≥ 50 步；状态栏显示鼠标 mm 坐标；自动生成的元素与手动元素用不同颜色区分，低置信度元素高亮；手动修改过的自动元素，`source` 改为 `manual`

### 6.5 测试基准
`fixtures/floorplan-a.jpg`、`fixtures/floorplan-b.jpg` 各配一份人工标注的标准答案 JSON（`fixtures/*.expected.json`），由测试计算：
- 墙体召回率 / 准确率（中心线距离 < 100mm 且角度差 < 3° 视为匹配）
- 比例尺误差
- 房间数量与类型匹配数

---

## 7. 家具布置（`src/layout`）

所有布置结果都写入 `furniture[]`，标记 `source: 'auto'`，随后可在编辑器中手动微调（拖动、旋转、改尺寸、删除、添加）。

### 7.1 默认布置
按优先级：
1. **来自户型图符号**：§6.1 第 6 步识别到的家具符号 → 映射到家具库条目，按包围盒设置位置、尺寸、朝向
2. **按房间类型的规则**（`layout/rules/*.ts`，每种房间类型一个文件）：符号没有覆盖到的房间，按规则自动生成。例如：
   - 卧室：床头靠最长的实墙（不含门窗）居中；两侧床头柜；衣柜放在剩余最长墙面，避开门的开启范围
   - 客厅：沙发与电视柜面对面，靠两面相对的长墙；茶几居中；地毯在沙发前
   - 餐厅：餐桌居中，椅子数量按面积决定（4 或 6）
   - 厨房：沿墙布置 L 形或一字形地柜 + 吊柜，冰箱放在靠门一端
   - 卫生间：马桶、浴室柜、淋浴区沿墙布置，避开门
3. **通用约束**（`layout/validate.ts`）：家具不与墙体相交、不挡门（门前保留 800mm 净空）、主要通道宽度 ≥ 700mm；违反的家具标为警告

### 7.2 按需求生成
- 用户在文本框输入需求，例如：「两个人住，需要一间书房，客厅要大沙发，餐厅坐 6 人」
- `/api/layout`：调用大语言模型，把需求解析为结构化参数（Zod 校验），例如：
  ```json
  { "roomOverrides": [{ "roomId": "r3", "type": "study" }],
    "furniturePrefs": [{ "roomType": "living", "item": "sofa", "size": "large" },
                       { "roomType": "dining", "seats": 6 }] }
  ```
- **LLM 只负责解析需求，不直接输出坐标**：拿到参数后由 §7.1 的规则引擎重新布置，保证结果符合约束
- 重新生成时保留用户手动摆放过的家具（`source: 'manual'`），除非用户勾选"全部重来"

---

## 8. 3D 白模（`src/scene3d/buildScene.ts`）

项目数据 → Three.js 场景，数据变化时整体重建（户型规模小）。

- **墙体**：每段墙为沿中心线扩展 thickness/2 的长方体；洞口**不用 CSG**，把墙段沿长度切开：洞口两侧为完整高度墙块，下方为 sillHeight 高的墙块，上方为过梁
- **墙角**：端点重合的墙段各自延伸 thickness/2，允许轻微重叠
- **地面 / 天花板**：房间多边形 → `ShapeGeometry`；`cove_light` 吊顶内缩 300mm、下沉 100mm，边缘放自发光条表示灯带位置
- **门窗**：门为 40mm 厚板（关闭状态）；窗为窗框 + 半透明玻璃
- **家具**：每个家具库条目实现 `buildMesh(size)`，用 2–4 个长方体 / 圆柱拼出粗略造型
- **类别标记**：每个物体的 `userData.category` 记录类别，供分割图使用
- 编辑器内提供 3D 预览标签页（可轨道旋转查看），用于检查建模结果

---

## 9. 风格与彩色平面图

### 9.1 风格输入
- 风格预设（§13）或自由输入关键词，二者可同时使用（关键词追加在预设之后）
- 可上传一张参考图

### 9.2 彩色平面图生成
1. 从白模渲染**正交俯视**结构图：去掉天花板，正交相机正上方俯视，导出线稿图 + 语义分割图 + 白模图
2. 调用图像生成 Provider（§10.3），提示词为"俯视彩色户型平面图（彩平图），[风格描述]，[各房间家具]"
3. 生成结果叠加房间名称标注（在前端用文字叠加，不交给 AI 画字）
4. 用户可以：确认 / 修改关键词重新生成 / 回到家具布置调整
5. **确认后**：把当前风格描述、种子写入 `StyleConfig`，并让用户核对一份**材质清单**（例如「人字拼胡桃木地板、奶油色墙面、深棕皮沙发」，由提示词模板生成、可编辑），锁定到 `materialPalette`，后续全景全部沿用

---

## 10. 720° 全景渲染

### 10.1 锚点
- **默认生成**：每个房间（阳台、走廊除外）一个锚点，位于房间内远离家具的开阔点（在房间多边形内采样，选离最近家具 / 墙体距离最大的点），高度 1400mm
- 用户可在 2D 平面上拖动、增删锚点，设置名称和默认朝向
- **跳转热点自动生成**：两个房间之间有门或门洞相连 → 在各自锚点上生成指向对方的热点，yaw 取从本锚点看向那扇门中心的方向；用户可手动增删

### 10.2 全景结构图
- 在每个锚点放 `CubeCamera`，分别渲染六面的白模图 / 深度图 / 线稿图 / 分割图
- 将六面转换为**等距柱状投影**（2:1，默认 4096×2048；生成时可降到 2048×1024）
- 深度图近亮远暗；分割色表固定写在 `catalog.ts`；分割 pass 关闭抗锯齿

### 10.3 图像生成 Provider

```ts
interface RenderRequest {
  mode: 'floorplan' | 'panorama' | 'panorama_face';
  controls: { depth?: string; lineart?: string; segmentation?: string; white?: string };  // base64 PNG
  referenceImage?: string;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  width: number;
  height: number;
  strength?: number;
}
interface RenderProvider {
  id: string;
  supports: { depth: boolean; lineart: boolean; segmentation: boolean; reference: boolean; panorama: boolean };
  render(req: RenderRequest): Promise<{ image: string; meta: Record<string, unknown> }>;
}
```

- `mock` Provider：返回传入的白模图，叠加文字 "MOCK"。**在接入真实服务前，所有流程用它跑通**
- 真实 Provider 选型见 §16

### 10.4 全景生成策略（按优先级尝试，以效果决定）
- **策略 A：整张全景生成**。若 Provider 支持 360° 全景 + 结构条件输入，直接输入等距柱状投影的结构图生成整张全景
- **策略 B：分面生成再拼接**。逐面生成立方体六面（同一种子、同一提示词、参考图锚定），再转换为等距柱状投影；在接缝处做羽化融合。上下两面（天花板 / 地面）可以简化处理
- **策略 C（兜底）**：每个锚点生成 4 张水平方向的透视效果图，查看端以"可左右滑动的图组"展示，而不是全景
- 实现时把三种策略都封装在 `src/scene3d/panorama.ts`，通过配置切换

### 10.5 一致性
1. 所有全景使用同一 `materialPalette` + 风格描述 + 种子
2. 已确认的彩平图作为参考图传入
3. 第一张定稿的全景，作为后续全景的追加参考图
4. 同类物体在所有分割图中颜色一致

### 10.6 结果管理
- 每个锚点保留历史全景，可重新生成、标记定稿
- 编辑器内用与查看端相同的 `PanoramaViewer` 预览

---

## 11. 发布与手机查看

### 11.1 发布
- 前提：每个锚点都有一张定稿全景
- `/api/publish`：
  - 把定稿全景压缩为 WebP / JPEG（长边 4096，另生成 2048 的低清版本供首屏快速加载），上传到对象存储
  - 生成分享数据 `share.json`：项目名、锚点列表（名称、全景图 URL、默认朝向、热点）、可选的彩平图 URL；**不包含**原始户型图、墙体坐标等编辑数据
  - `shareId` 使用不可猜测的随机 ID（≥ 16 位）
- 可"撤销分享"：标记 revoked，并删除对象存储中的图片
- 重新发布会覆盖同一个 `shareId` 的内容

### 11.2 查看页 `/s/[shareId]`
- **手机优先**：竖屏全屏显示全景；单指拖动旋转，双指缩放；支持陀螺仪（iOS 需要用户点按后申请权限）
- **锚点跳转**：热点显示为带文字的圆点（参考溜溜全景的样式），点击切换到目标锚点，带淡入淡出过渡
- 底部房间列表（横向滚动的缩略图），可直接跳转
- 可选：右上角按钮显示彩平图，点击彩平图上的房间也能跳转
- 先加载低清全景，再替换为高清
- **微信内置浏览器**必须能正常打开和操作（在 Playwright 移动端视口 + 真机上验证）
- 页面设置 Open Graph 标题和缩略图，在微信里分享时显示预览卡片

---

## 12. 隐私与安全

- 编辑中的项目默认只存在浏览器（IndexedDB）
- **调用外部 AI 服务前提示用户**：首次调用识别兜底、需求解析、图像生成时，弹窗说明要发送哪些内容、发送给哪类服务，用户确认后才发送。图像生成只发送结构图和参考图，**不发送原始户型图**
- 上传的户型图读取时用 canvas 重绘，去掉 EXIF
- 编辑器提供遮挡工具，可盖住楼盘名、楼栋号等文字
- 分享页只包含全景图和锚点信息；任何拿到链接的人都能看，发布前提示用户这一点
- API Key 只在服务端环境变量中；`.env*` 不进仓库（`.env.example` 除外）；日志中不打印 Key 和图片内容
- 不接入统计 / 埋点 SDK

---

## 13. 家具库与风格预设

### 13.1 家具库（`catalog.ts`）最小集合（默认尺寸 W×D×H，mm）

| 房间 | 家具 |
|---|---|
| 客厅 | 三人沙发 2400×900×800、大沙发 3000×950×800、单人椅 800×800×750、圆茶几 Ø900×400、电视柜 2400×400×450、电视 1450×60×830（离地 900）、地毯 2400×1700×10 |
| 餐厅 | 圆餐桌 Ø1200×750、长餐桌 1600×900×750、六人餐桌 1800×900×750、餐椅 500×500×800、餐边柜 1600×450×900 |
| 卧室 | 双人床 1800×2100×1000、单人床 1200×2000×900、床头柜 500×400×500、衣柜 2000×600×2400 |
| 书房 | 书桌 1400×700×750、书柜 1200×350×2000、办公椅 600×600×1000 |
| 厨房 | 地柜 600 深 ×850 高（按长度拉伸）、吊柜 350 深 ×700 高（离地 1500）、冰箱 700×700×1800 |
| 卫生间 | 马桶 400×700×750、浴室柜 800×500×850、淋浴区 900×900×10 |
| 通用 | 绿植 Ø500×1200、落地灯 Ø400×1600、装饰画 800×30×1000（贴墙，离地 1200） |

每个条目包含：`id`、中文名、类别、默认尺寸、离地高度、分割色、`buildMesh`、可映射的户型图符号类别。

### 13.2 风格预设（`stylePresets.ts`）

```ts
{
  id: 'cream-walnut',
  name: '奶油原木',
  prompt: 'warm cream-colored walls, herringbone walnut wood floor, dark brown leather sofa, '
    + 'recessed ceiling with hidden warm LED cove lighting, walnut wood cabinetry, '
    + 'round wooden coffee table, soft textured rug, mid-century dining chairs, '
    + 'warm and calm atmosphere, 3000K lighting',
  materials: ['奶油色乳胶漆墙面', '人字拼胡桃木地板', '深棕皮沙发', '胡桃木柜体'],
}
```
另有 `modern-minimal`（现代极简）、`japandi`（日式原木）、`french-vintage`（法式复古），先写提示词，不做专门调优。
`fixtures/style-reference.jpg` 可作为 `cream-walnut` 的参考图。

---

## 14. 分阶段里程碑

每个阶段都有可以演示的成果。阶段内的 Issue 按编号顺序完成。

| 阶段 | 内容 | 依赖外部 AI | 演示成果 |
|---|---|---|---|
| **P1 基础与编辑器** | 脚手架、数据模型、画布与校准、墙 / 门窗 / 房间 / 家具编辑工具 | 否 | 手动描出一套户型并保存 |
| **P2 自动识别** | 比例尺 OCR、墙体、门窗、房间、家具符号识别；识别报告与修正 | 可选（视觉模型兜底） | 上传 `floorplan-a.jpg`，自动得到可修正的户型 |
| **P3 自动布置** | 规则引擎、符号映射、约束校验、按需求生成 | 是（需求解析用 LLM） | 一键布置；输入需求后重新布置 |
| **P4 3D 白模与锚点** | buildScene、3D 预览、锚点与热点自动生成、全景结构图导出 | 否 | 每个房间导出等距柱状投影的结构图 |
| **P5 查看端（mock 数据）** | PanoramaViewer、热点跳转、分享页、移动端适配 | 否 | 手机上用白模全景完整体验跳转 |
| **P6 风格与彩平图** | 风格输入、俯视结构图、彩平图生成、确认与材质清单锁定 | 是 | 生成并确认一张彩平图 |
| **P7 全景渲染** | 策略 A/B/C、一致性、结果管理 | 是 | 每个房间一张风格一致的全景 |
| **P8 发布** | 对象存储、发布 / 撤销、分享数据、部署上线 | 否 | 把链接发给朋友，微信里打开能看 |

> 说明：P5 先用白模全景打通手机查看和分享体验，不必等 AI 渲染完成，可以尽早在真机上验证交互。

### 关键验收标准（摘要，细节写在各 Issue 中）
- **P2**：`floorplan-a.jpg` 墙体召回率 ≥ 85%、准确率 ≥ 85%；比例尺误差 < 1%；手动修正到可用的时间 < 10 分钟
- **P3**：自动布置的家具 0 个与墙相交、0 个挡门
- **P5**：iOS Safari、安卓 Chrome、微信内置浏览器都能打开；拖动流畅；热点跳转正确
- **P7**：同一项目各全景的地板、墙面、主要家具材质肉眼看属于同一套装修；墙体、门窗位置与白模一致
- **P8**：撤销分享后链接不可访问、图片已删除

---

## 15. 风险与已知局限

| 风险 | 影响 | 缓解 |
|---|---|---|
| 识别不准 | 修正工作量大 | 识别结果按置信度高亮；修正工具完善；视觉模型兜底；用测试基准持续改进 |
| AI 不遵守结构 | 门窗位置偏移、多出家具 | 优先选用支持结构条件输入的模型；提高约束强度；线稿 + 分割图叠加 |
| 全景接缝 / 变形 | 转动时能看到断裂 | 策略 A 优先；策略 B 做羽化融合；最差回退到策略 C |
| 多房间风格不一致 | 像不同的房子 | §10.5 四项措施；以彩平图确认的材质清单为准 |
| 微信浏览器兼容 | 朋友打不开 | P5 尽早真机测试；避免使用微信不支持的 API |
| AI 与存储成本 | 反复生成、图片存储产生费用 | 显示每次调用的预估成本；mock 模式调试；撤销分享时删除图片 |

---

## 16. 待确认决策（先按默认值实现）

| 决策 | 默认值 | 备注 |
|---|---|---|
| 图像生成 Provider | P6 前确认；之前只用 mock | 需要核实：是否支持深度图 / 线稿条件输入、是否支持 360° 全景、价格、国内访问 |
| LLM（需求解析 / 视觉识别兜底） | P2 / P3 前确认 | 需要支持结构化 JSON 输出与图像输入 |
| 识别在前端还是服务端 | 先在浏览器用 opencv.js；性能不够再拆 Python 服务 | |
| 部署平台与对象存储 | P8 前确认 | 若主要给国内朋友看，需考虑访问速度 |
| 界面语言 | 中文；代码与注释用英文 | |
