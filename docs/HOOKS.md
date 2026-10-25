# Agent hooks

Tofu listens for events from coding agents on a tiny loopback HTTP server and turns them into desktop reactions. Nothing leaves your machine.

> **DeepSeek Harness users:** install the native Host-only bundle described in [DSH.md](DSH.md) instead of wiring hooks manually.

```text
agent hook / shell
        │
        ▼
bin/tofu-hook.mjs  ──HTTP──▶  127.0.0.1:41234  ──IPC──▶  Tofu window
        │
        └─ reads ~/.tofu/hook.json for the current port
```

## The fast path

The desktop app starts the server automatically. From the project root:

```bash
node bin/tofu-hook.mjs pre --tool edit
node bin/tofu-hook.mjs stop
node bin/tofu-hook.mjs bubble --text "build is green"
```

The **设置 → 03 助手联动** panel shows the exact absolute command for your install and a copy button. In a packaged build, the CLI is staged at:

```text
Windows:  %USERPROFILE%\.tofu\tofu-hook.mjs
macOS:    ~/.tofu/tofu-hook.mjs
Linux:    ~/.tofu/tofu-hook.mjs
```

In development it points at `bin/tofu-hook.mjs` in this repository.

## Events

| CLI event | Desktop state | Notes |
| --- | --- | --- |
| `session-start` | jump → working | a session began |
| `user-prompt` | jump → working | user submitted a prompt |
| `pre --tool <name>` | working / review | read/grep/glob become reviewing; edit/bash/write become working |
| `post` | reviewing | a tool returned |
| `waiting` | waiting | needs approval or user input |
| `stop` | waving → idle | task finished; adds a little joy |
| `session-end` | waving → idle | session closed |
| `failure` | failed | error / sad face |
| `bubble --text "..."` | unchanged | show a message without changing state |
| `idle` / `working` / `review` | direct state | for custom agents |

`--source <name>` is shown in the little agent chip above the bubble. Use `claude`, `codex`, `dsh`, etc.

### CLI options

```text
tofu-hook <event> [options]

  --tool <name>       edit, read, bash, grep, test, web, task...
  --text <message>    custom bubble text (max 190 chars)
  --source <name>     agent label
  --duration <ms>     how long to hold the state
  --stdin             map a Claude Code hook JSON payload from stdin
  --quiet             print nothing (automatic with --stdin)
  --url <url>         explicit hook server URL
```

Environment overrides:

```bash
TOFU_HOOK_URL=http://127.0.0.1:41234
TOFU_HOOK_PORT=41234
```

The CLI always exits `0` if Tofu is not running, so a closed desktop app cannot break an agent hook.

## Claude Code

Add hooks to `.claude/settings.json` in your project, or to your user-level Claude Code settings. Replace the path with the one shown in Tofu's settings.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\YOU\\.tofu\\tofu-hook.mjs\" --stdin", "timeout": 5 }
        ]
      }
    ]
  }
}
```

The stdin mapper understands Claude Code's `hook_event_name`:

| Claude event | Tofu event |
| --- | --- |
| `SessionStart` | `session-start` |
| `UserPromptSubmit` | `user-prompt` |
| `PreToolUse` | `pre` (with `tool_name`) |
| `PostToolUse` | `post` |
| `PostToolUseFailure` | `failure` |
| `Notification` / `PermissionRequest` | `waiting` |
| `Stop` / `SubagentStop` | `stop` / `post` |
| `SessionEnd` | `session-end` |

`--stdin` is quiet by default; it does not write hook output that the agent could mistake for context.

## Any other agent

### Shell

```bash
node /absolute/path/to/tofu-hook.mjs session-start --source my-agent
node /absolute/path/to/tofu-hook.mjs pre --tool edit --source my-agent
node /absolute/path/to/tofu-hook.mjs stop --source my-agent
```

### curl

```bash
curl -s http://127.0.0.1:41234/event \
  -H 'Content-Type: application/json' \
  -d '{"type":"pre","tool":"edit","source":"my-agent"}'

curl -s http://127.0.0.1:41234/bubble \
  -H 'Content-Type: application/json' \
  -d '{"text":"build is green","source":"my-agent"}'
```

### PowerShell

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:41234/event `
  -ContentType 'application/json' `
  -Body '{"type":"waiting","source":"my-agent"}'
```

### HTTP API

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/health` | — |
| `POST` | `/event` | `{ "type": "pre", "tool": "edit", "source": "claude", "text": "...", "duration": 3000 }` |
| `POST` | `/bubble` | `{ "text": "hello", "source": "claude" }` |
| `POST` | `/state` | `{ "state": "working" }` |

`GET /health` returns:

```json
{
  "ok": true,
  "app": "tofu",
  "version": "1.0.0",
  "port": 41234,
  "state": "working",
  "uptime": 42
}
```

## Port discovery

The desktop app writes:

```text
~/.tofu/hook.json
```

with the actual port, because the configured port may be busy and fall back to the next one. The CLI reads that file automatically. If the home directory is not writable, the app stages the descriptor under its user data directory (`Tofu/hooks/hook.json`), and the CLI knows that fallback location too.

To use a fixed endpoint regardless of discovery:

```bash
TOFU_HOOK_URL=http://127.0.0.1:41300 node bin/tofu-hook.mjs stop
```

## Security / privacy

- The HTTP server binds to **127.0.0.1 only**.
- Requests carrying a browser `Origin` header are rejected with `403`.
- Body size is capped at 16 KB and events are rate-limited.
- The server has no remote endpoints, no telemetry, and no credentials.
- Any local process can send it harmless state changes; it cannot read your files or execute commands.

## Troubleshooting

**`tofu: desktop not running`**  
Open Tofu from the tray. The CLI intentionally exits `0`; an agent hook should never fail because a desktop pet is asleep.

**Health works but nothing moves**  
The pet window may be hidden. Use the tray menu or `Ctrl + Alt + P`.

**Port changed but the CLI still uses the old one**  
The CLI reads `~/.tofu/hook.json`. If you copied the command earlier, re-open Settings and copy again — it includes the current absolute path. The descriptor holds the live port.

**Claude Code hook does not fire**  
Run the same command manually with a sample payload:

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Edit"}' | node bin/tofu-hook.mjs --stdin
```

If that works, the hook configuration path or permission is the issue, not Tofu.

**The pet is behind another always-on-top window**  
Tofu uses the `screen-saver` always-on-top level when enabled. Some apps also assert topmost; toggle Tofu from the tray to re-raise it.

**Uninstall hooks**  
Remove the entries you added to `.claude/settings.json`. Tofu does not modify agent settings on its own.
