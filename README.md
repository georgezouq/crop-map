# US Crop Atlas · 美国作物地图

基于 [SabhyaC26/crop-map](https://github.com/SabhyaC26/crop-map) 的美国农业历史地图。全国模式使用 USDA NASS Cropland Data Layer（CDL），保留 MapLibre、原项目的 Figtree 字体和作物图标。

## 直接运行

需要 Node.js 22.12+、npm 和网络连接，无需 USDA API key。

```sh
cd site
npm ci
npm run build
npm start
```

打开 **http://localhost:8787**。全国年度目录已包含在仓库。服务默认仅监听本机；`PORT`、`HOST` 可配置。全国页面需要此 Node 服务，不能仅发布 `site/dist` 到静态托管。

开发时，在 `site/` 运行 `npm run dev`，同时启动 API（8787）和 Vite（5175）。两端口须空闲。只启动 API 用 `npm run api`，只启动前端用 `npm run dev:site`。

## 使用

- 选择本土州或夏威夷，按年份浏览所有已接入的 CDL 图层。
- 通过作物选择框或常见作物按钮，仅显示所选类别；透明度控制用于对照底图。
- 点击地图，或选择“玉米带 / 中央谷地 / 夏威夷”地点，读取同一坐标全部可用年度的分类。
- 用时间轴、年份下拉框、前后按钮或历史记录切换年份。
- “导出 CSV”包含坐标、年份、类别代码、类别名称、查询状态、样本分辨率、来源和读取时间。无数据和查询失败独立标记。
- 地址栏保留地区、年份、类别及所选坐标，复制 URL 可恢复查询。自由平移后的视角不保存。
- 勾选“显示 2008 年以前”可探索早年部分州数据。

## 数据覆盖

| 地区 | 年份 | 范围 |
| --- | --- | --- |
| 美国本土 48 州 | 2008–2025 | 全国完整覆盖 |
| 美国本土部分州 | 1997–2007 | 仅部分州；无数据不等于无农业 |
| 夏威夷 | 2023–2025 | 独立 HCDL 服务和分类表 |
| 阿拉斯加 | 无 | 此数据源不覆盖，地图明确提示 |

目录从官方服务发现实际年度与 raster ID，不自动猜测未来年份。当前目录包含本土 29 年、夏威夷 3 年。地图与历史查询都锁定年度的实际 raster ID，缺失年份直接报错，不回退到最新年。

CDL 是卫星识别的土地覆盖栅格，并非 DWR 的地块矢量、农户申报数据、农场边界或官方面积统计。服务的 `Acreage` / `Count` 总表不是逐年统计，本项目不使用它们生成面积趋势。本土 2008–2023 原始分辨率为 30 m，2024 起为 10 m；早年个别数据集为 56 m。缩放后的显示像素与原始分辨率不同。单点跨年变化也可能来自定位、分辨率或分类方法变化。

这些是当前能获取的历史修订版本，不是历史发布日期对应的数据快照，不能直接当作没有前视偏差的交易回测数据。后续若用于因子研究，应另建发布时间、版本和修订记录，并结合 Quick Stats 统计口径。

## 加载与缓存

全国模式：浏览器 → 本地 Node 服务 → USDA 官方图像 / 样本服务。每个地图图块按需请求并落盘；历史查询逐年进行，避免官方单次查询的默认 5 个 raster 上限。早年无覆盖先检查官方 footprint，空洞用年度锁定的 identify 验证 NoData。

缓存位于 `data/cache/usda/`，默认最多约 1 GiB（每分钟清理一次，短时可能超出）、有效期 7 天，支持进程重启后复用；并发相同请求合并，失败不写入。响应包含缓存状态和读取时间。`CROP_CACHE_DIR` 可以指定持久化目录。底图由 Esri 提供，不进入 USDA 缓存。

**按需缓存不是全国原始数据的完整离线镜像。** 未访问图块、未缓存坐标和底图需要联网。原始 GeoTIFF 下载与在线地图是独立流程；下载 ZIP 不会自动转换为离线地图瓦片。若要离线展示全国高分辨率历史数据，需额外配置栅格切片或 COG 服务及存储。

## 同步年度目录

```sh
cd site
npm run import:usda
npm test
npm run build
```

同步会读取官方年度清单、类别色表和地理覆盖边界，校验后原子更新 `site/public/data/usda/catalog.json`。同步后重启 Node 服务。footprint 留在服务端，不传到浏览器。不要把目录中的年度统计以外字段当作产量或面积。

## 下载全国原始历史数据

从官方发布页提取真实 ZIP 链接，默认只生成下载清单，不下载数十 GB 文件：

```sh
python3 pipeline/download-usda.py --years 2008:2025 --hawaii
```

完整下载本土 30 m 历史文件和夏威夷文件：

```sh
python3 pipeline/download-usda.py --years 2008:2025 --hawaii --download
```

`--resolution 10` 选择 2024 年起的原生 10 m 文件；较早年份仍使用 30 m。支持 HTTP 断点续传、ZIP 结构检查、本地 SHA-256 记录。SHA-256 是下载后的本地校验值，不是 USDA 提供的签名。已完成文件有独立 receipt，可跳过；下载结果位于 `data/raw/usda/`，不进入 Git。离线存储需求应考虑压缩文件、解压文件和瓦片的额外空间。

## 项目结构

- `site/src/usda/`：全国地图、年份控制、地点历史、CSV、响应式布局。
- `server/index.mjs`：HTTP API 与生产静态文件服务。
- `server/cdl.mjs`：年度锁定、坐标校验、图块转换、覆盖范围和样本解析。
- `server/upstream.mjs`：官方请求重试、磁盘缓存、原子写入和清理。
- `pipeline/import-usda.mjs`：同步官方目录。
- `pipeline/download-usda.py`：全国原始 GeoTIFF ZIP 下载器。
- `tests/usda/`：自动化数据逻辑测试和真实服务验收。

## 验证

```sh
cd site
npm test
npm run build
npm audit
# 在另一个终端启动 npm start 后，继续在 site/ 内执行：
node ../tests/usda/live.mjs
# 浏览器验收：
npx playwright install chromium --only-shell
npm run test:browser
# 或使用已安装的 Chrome（独立测试 profile）：
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

真实服务验收检查本土 29 年、夏威夷 3 年、无覆盖、年度图块差异、作物筛选、缓存命中、无效请求和生产页面。第三方服务内容或可用性变化可能导致真实服务验收失败；单元测试不依赖网络。

## 加州 DWR 地块页面

`/california.html` 保留原项目的加州 DWR 地块体验，它与全国 CDL 的数据口径不同。需要按原始流水线准备 `basemap.pmtiles`、`fields.pmtiles`、`overview.pmtiles`、`fields-low.pmtiles`，或者在构建时指定自己的文件托管地址：

```sh
cd site
VITE_BASEMAP_URL=https://tiles.example.com/basemap.pmtiles \
VITE_FIELDS_URL=https://tiles.example.com/fields.pmtiles \
VITE_OVERVIEW_URL=https://tiles.example.com/overview.pmtiles \
VITE_FIELDS_LOW_URL=https://tiles.example.com/fields-low.pmtiles npm run build
```

DWR 原始流水线使用 Python、GDAL、tippecanoe、pmtiles：`make setup`、`make download`、`make all`、`pipeline/basemap.sh`。全国模式不依赖这些大型 PMTiles。`deploy.sh` 是原加州静态网站的部署工具，不能单独部署全国 API。

## 托管与维护

全国模式可部署到支持 Node 22.12+ 的服务器或容器：执行 `npm ci`、`npm run build`，以 `HOST=0.0.0.0 npm start` 启动，并为缓存目录挂载持久化磁盘。正式公网服务应增加 HTTPS、访问控制或限流；本仓库默认本机使用，未执行公网部署。USDA 服务不可用时显示错误与重试入口，已缓存且未过期的数据可复用。

下一步可添加：州 / 县级面积统计（需明确统计口径）、双年份对比、批量坐标研究任务、COG 离线服务、发布时间与修订版本档案。

## 来源与许可

- [USDA NASS CDL](https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php)、[官方原始数据下载](https://data.nass.usda.gov/Research_and_Science/Cropland/Release/)。CDL 是公共领域数据。
- 本土服务：`https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer`；夏威夷：同路径的 `CDL_WM_Hawaii/ImageServer`。
- 底图：[Esri World Light Gray Canvas](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer)，来源署名包括 Esri、HERE、Garmin、OpenStreetMap 和 GIS user community。
- 加州地块：California Department of Water Resources Statewide Crop Mapping 2023 / Land IQ。
- 原项目代码及原作图标：SabhyaC26，MIT；Microsoft Fluent Emoji（MIT）、Figtree（SIL OFL）、原加州 OSM / Protomaps 底图（ODbL）保留各自许可与署名。
