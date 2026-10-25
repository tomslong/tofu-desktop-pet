# DeepSeek Harness (DSH) 联动

Tofu 提供一个 **Host-only DSH bundle**，安装到当前 DSH profile 后，DSH 的 agent 活动会自动同步给桌面上的猫。

```text
DSH agent / tools
       │  Cordis events
       ▼
@tofu/dsh-bridge  ──HTTP──▶  127.0.0.1:41234  ──▶  Tofu window
```

它只发送工具名和生命周期事件。**不会发送提示词、工具参数、文件内容或工具结果。**

## 安装

1. 打开 Tofu 设置页 **03 助手联动**。
2. 找到 **DeepSeek Harness** 卡片，点击 **复制安装指令**。
3. 在 DSH 里把指令粘贴给 agent，例如：

```text
请用 plugin_manager 的 install_bundle 安装这个 Tofu DSH 插件：
C:\path\to\tofu\integrations\dsh
```

4. 批准 DSH 的插件安装操作。DSH 的 Plugin Manager 会完成 package 安装和 bundle selection。
5. 安装完成后，在 DSH 里跑一个工具或发一条 prompt，Tofu 应该会开始响应。

开发环境中的 bundle 路径是：

```text
<repo>/integrations/dsh
```

打包后的 Tofu 会把 bundle 放到：

```text
<解压目录>/resources/dsh-plugin
```

Tofu 设置页里显示的是当前真实路径，直接复制即可。

> DSH 版本要求：`0.2.1` 或更高。`install_bundle` 是 DSH 的插件管理器操作，具体入口以你当前 DSH 版本的 Settings / Plugin Manager 为准。

## 映射

| DSH 事件 | Tofu |
| --- | --- |
| `agent/created` | session start |
| `agent/pre-step` step 1 | user prompt |
| `tools/pre-execute` | working / reviewing |
| `tools/result` success | reviewing |
| `tools/result` error | failed |
| `agent/turn-stopping` | waving / done |
| `agent/error` | failed |
| `agent/disposed` | session end |
| `user-questions/request` | waiting |
| `ask_user` / permission-ish tools | waiting |

`read` / `grep` / `glob` 类工具会让猫拿放大镜；编辑、命令、写入类工具会让它打开小终端。工具失败时耳朵会耷拉下来。

## Hook 端口发现

插件先读 DSH 进程用户目录下的：

```text
~/.tofu/hook.json
```

从中获取 Tofu 当前实际端口（Tofu 配置的端口若被占用会自动后移）。读不到时使用默认：

```text
http://127.0.0.1:41234
```

也支持显式配置：

```yaml
- id: tofu-dsh-bridge
  name: '@tofu/dsh-bridge'
  config:
    source: dsh
    url: http://127.0.0.1:41234
```

环境变量 `TOFU_HOOK_URL` 也可以覆盖默认地址。

## Bundle 结构

```text
integrations/dsh/
  package.json          @tofu/dsh-bridge, dsh.bundle.patch
  cordis.patch.yml      insert tofu-dsh-bridge
  index.js              Cordis Host plugin
  locale/en.json        plugin display metadata
  locale/zh.json
  icon.svg
  README.md
```

插件自身没有运行时依赖；它使用 DSH 的 cordis context 事件和 Node 内置 `fetch`。

## 安全与边界

- 只监听 Tofu 的 loopback 地址。
- DSH 插件只观察事件，不修改工具调用、工具结果或 agent 状态。
- 不发送 prompt / arguments / result / 文件路径。
- 网络失败会被静默吞掉，不会阻塞 DSH 工具链。
- 可以在 DSH Plugin Manager 中禁用或卸载 `tofu-dsh-bridge`。

## 排查

**Tofu 没反应**

1. 确认 Tofu 正在运行，且设置页 **03 助手联动** 显示 `LISTENING`。
2. 在 DSH 里发一个会调用工具的 prompt，而不是只聊天。
3. 检查 bundle 是否在 DSH 当前 profile 中启用。
4. 如果 Tofu 改过端口，检查 `~/.tofu/hook.json` 或直接在插件 config 里写死 `url`。

**安装后需要重启 DSH 吗？**

新 bundle 可能通过 HMR 立即生效；如果 Plugin Manager 显示 `restart-required`，重启 DSH。替换已安装的 bundle 后也建议重启。

**不想用了**

在 DSH Plugin Manager 中禁用/移除 `tofu-dsh-bridge`，或删除 profile patch 中的对应行。Tofu 本身不会修改你的 DSH 配置。
