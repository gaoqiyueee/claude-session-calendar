#!/bin/bash
# 把插件复制到 CloudCLI 插件目录、把 skill 复制到 ~/.claude/skills。重复运行即更新。
# CloudCLI 扫描插件时只认真实目录，不认软链接，所以这里用复制。
set -euo pipefail
cd "$(dirname "$0")"

PLUGIN_DIR="$HOME/.claude-code-ui/plugins/session-calendar"
SKILL_DIR="$HOME/.claude/skills/session-goal"

mkdir -p "$PLUGIN_DIR" "$SKILL_DIR/scripts"
cp plugin/manifest.json plugin/index.js plugin/server.js plugin/icon.svg "$PLUGIN_DIR/"
cp skill/SKILL.md "$SKILL_DIR/"
cp skill/scripts/sg.py "$SKILL_DIR/scripts/"
chmod +x "$SKILL_DIR/scripts/sg.py"

echo "插件 → $PLUGIN_DIR"
echo "skill → $SKILL_DIR"
echo "CloudCLI 里打开「设置 → 插件」确认「会话日历」已启用；改了 server.js 需要在那里停用再启用一次。"
