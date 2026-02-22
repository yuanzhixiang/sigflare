# sigflare

一个极简的 PV 上报服务（TypeScript + Vite），用于在 Cloudflare 上接收事件并将原始请求数据写入 ClickHouse。
项目已拆分为两个独立脚本：

- 前端采集脚本：`src/tracker.ts`
- 后端 Worker 脚本：`src/index.ts`

## 目标

- 使用 TypeScript 编写，打包为 JavaScript
- 使用 Vite 打包发布到 npm
- HTTP 层保持原始写法（原生 Request/Response）
- 第一版只落库 `pv` 事件

## 快速开始

```bash
pnpm install
pnpm run dev
```

`pnpm run dev` 会并行启动：

- tracker 实时编译（`src/tracker.ts` -> `dist/tracker/sigflare-tracker.js`）
- tracker 静态文件服务（`http://127.0.0.1:8788`）
- Worker 开发服务（`http://127.0.0.1:8787`）

本地开发地址：

- 采集脚本：`http://127.0.0.1:8787/sigflare-tracker.js`
- PV 上报接口：`http://127.0.0.1:8787/collect`
- 前端错误上报接口：`http://127.0.0.1:8787/error`

构建产物：

```bash
pnpm run build
```

生产部署（会先 build 再 deploy）：

```bash
pnpm run deploy:prod
```

## 路由设计

- `GET /sigflare-tracker.js`：返回前端采集脚本（开发时读取实时编译产物，生产从 Worker Assets 返回）
- `POST /collect`：接收 `event: "pv"` 并打印日志
- `POST /error`：接收 `event: "fe_error"` 并打印日志

## 端到端接入

### 1) 构建并分发前端采集脚本

构建产物：

- `dist/tracker/sigflare-tracker.js`

可以通过 npm/CDN 分发，或者复制到你自己的静态资源服务。

### 2) 前端接入脚本

在业务网站中直接引用：

```html
<script
  src="http://127.0.0.1:8787/sigflare-tracker.js"
  defer
></script>
```

生产环境可使用已构建产物：

```html
<script
  src="https://<worker-domain>/sigflare-tracker.js"
  defer
></script>
```

脚本会在页面加载时自动发送一次 `event: "pv"`。
默认上报规则：
- `pv` -> 脚本同域 `/collect`（例如 `https://<worker-domain>/collect`）
- `fe_error` -> 脚本同域 `/error`（例如 `https://<worker-domain>/error`）
- 可选：通过 `data-sigflare-endpoint` 和 `data-sigflare-error-endpoint` 分别覆盖两个端点。

### 3) 部署后端 Worker

`src/index.ts` 默认导出 Cloudflare Worker handler，并处理 `POST /collect` 与 `POST /error`：

```ts
export default { fetch: collect }
```

### 4) 作为 npm 模块复用后端（可选）

```ts
import { collect } from 'sigflare'

export default {
  async fetch(req: Request, env: Record<string, string>, ctx: unknown) {
    return collect(req, env as Record<string, string>, ctx as never)
  }
}
```

## 本地构建结果

- `pnpm run build` -> 同时产出后端与前端脚本
