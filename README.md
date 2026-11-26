# claude-session-calendar

在 [CloudCLI](https://github.com/siteboon/claudecodeui) 里按天回顾 Claude Code 会话，并给会话和项目设目标、状态、完成度。目的是在和 AI 的长对话里随时知道自己每天做了什么、每件事做到哪了。

包含三部分：

| 目录 | 是什么 |
|---|---|
| `plugin/` | CloudCLI 标签页插件「会话日历」：月历视图、热力图 + 当天详情、目标/状态/完成度编辑 |
| `skill/` | Claude Code skill `session-goal`：让 AI 设目标、改状态、按规则自评完成度 |
| CloudCLI fork | 侧边栏会话「⋯」菜单里一键切换状态，会话行显示状态标签（可选，见下文） |

## 功能

- **日历视图**：整月铺开，每天直接列出最活跃的会话，左侧色条表示状态，点标题跳到会话。
- **热力图 + 详情**：颜色深浅表示当天提问数；点某天，右侧按项目列出会话的时间段、提问数、目标、完成度和最近自评。
- **状态**：进行中 / 等待 / 挂起 / 已完成 / 已放弃。「未完结」页汇总所有进行中、等待、挂起的会话。
- **AI 自评**：在会话里说「自评一下」「设个目标」「把这个会话挂起」，AI 调用 `sg.py` 写入记录。自评只计入已验证的产出，跑偏会扣分；AI 不会擅自把会话标成已完成或已放弃。

## 安装

需要 Node.js 22+（插件后端用到内置 `node:sqlite` 读取 CloudCLI 的会话名）和 Python 3。

```bash
git clone https://github.com/gaoqiyueee/claude-session-calendar.git
cd claude-session-calendar
./install.sh
```

`install.sh` 会把插件复制到 `~/.claude-code-ui/plugins/session-calendar`，把 skill 复制到 `~/.claude/skills/session-goal`。之后刷新 CloudCLI，在「设置 → 插件」里确认「会话日历」已启用。更新代码后重新运行 `./install.sh`；改了 `server.js` 需要在插件设置里停用再启用一次。

### 侧边栏状态切换（可选）

这部分要改 CloudCLI 本身，放在 fork 的分支里：
[gaoqiyueee/claudecodeui@feat/session-status](https://github.com/gaoqiyueee/claudecodeui/tree/feat/session-status)

在你的 CloudCLI 源码目录里合入后重新编译前端：

```bash
cd ~/claudecodeui
git fetch https://github.com/gaoqiyueee/claudecodeui.git feat/session-status
git cherry-pick FETCH_HEAD
npm run build:client
```

没装插件或插件被停用时，这些按钮会自动隐藏。

## 数据

| 位置 | 内容 |
|---|---|
| `~/.claude/projects/**/*.jsonl` | Claude Code 会话日志，只读。只统计你亲手输入的提问，跳过工具结果、任务通知、续接摘要 |
| `~/.cloudcli/auth.db` | CloudCLI 数据库，只读，用来取你改过的会话名和项目名 |
| `~/.claude/session-goals/sessions/<会话ID>.json` | 会话的目标、状态、完成度、备注和修改历史 |
| `~/.claude/session-goals/projects/<路径哈希>.json` | 项目的同类记录 |
| `~/.claude/session-goals/.scan-cache.json` | 日志扫描缓存。Claude Code 清理 30 天前的日志后，日历上仍能看到那些天 |

插件和 skill 读写同一份记录，全部在本机，不联网。

## skill 命令

```bash
SG="python3 ~/.claude/skills/session-goal/scripts/sg.py"
$SG show                                   # 当前会话和项目的记录
$SG goal "一句话目标" [--project]
$SG status 挂起 [--project]                 # 进行中 / 等待 / 挂起 / 已完成 / 已放弃
$SG eval --progress 60 --note "已完成：…；剩余：…" [--status 进行中] [--project]
$SG list --open [--here]
```

会话 ID 默认取 `$CLAUDE_CODE_SESSION_ID`，在 Claude Code 外运行时加 `--session <ID>`。

## License

MIT（本仓库）。CloudCLI fork 沿用上游的 AGPL-3.0。
