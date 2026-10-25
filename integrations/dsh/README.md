# Tofu × DeepSeek Harness

A Host-only DSH bundle that mirrors agent activity to the Tofu desktop pet.

## Install

In DSH, ask the agent to install this directory with the `plugin_manager` tool:

```text
请用 plugin_manager 的 install_bundle 安装这个 Tofu DSH 插件：
<仓库路径>/integrations/dsh
```

The exact absolute path is shown in Tofu's **设置 → 03 助手联动 → DeepSeek Harness** card, with a copy button.

If your DSH build exposes a Plugin Manager UI, point **Install bundle** at the same directory.

## What it does

| DSH event | Tofu state |
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

Only tool names and lifecycle events are forwarded. Prompts, arguments, file contents and tool output stay in DSH.

## Config

The bundle's `cordis.patch.yml` sets `source: dsh`. It auto-discovers the Tofu hook port from `~/.tofu/hook.json`, falling back to `127.0.0.1:41234`.

To pin a URL, add this to the plugin config in your DSH profile patch:

```yaml
- id: tofu-dsh-bridge
  name: '@tofu/dsh-bridge'
  config:
    source: dsh
    url: http://127.0.0.1:41234
```

## Uninstall

Disable or remove the `tofu-dsh-bridge` bundle in DSH's Plugin Manager, or remove the row from your profile patch.
