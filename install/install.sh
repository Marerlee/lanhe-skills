#!/bin/bash
# 蓝禾技能库 - 一键安装（无 git 版）

echo "🔽 正在安装蓝禾技能库..."

# 创建目录
mkdir -p ~/.openclaw/workspace/lanhe-skills

# 下载主技能
echo "📥 下载 SKILL.md..."
curl -sL "https://raw.githubusercontent.com/Marerlee/lanhe-skills/main/SKILL.md" -o ~/.openclaw/workspace/lanhe-skills/SKILL.md

# 下载上传技能
echo "📥 下载 upload-skill/SKILL.md..."
mkdir -p ~/.openclaw/workspace/lanhe-skills/upload-skill
curl -sL "https://raw.githubusercontent.com/Marerlee/lanhe-skills/main/upload-skill/SKILL.md" -o ~/.openclaw/workspace/lanhe-skills/upload-skill/SKILL.md

# 下载 manifest.json
echo "📥 下载 manifest.json..."
curl -sL "https://raw.githubusercontent.com/Marerlee/lanhe-skills/main/manifest.json" -o ~/.openclaw/workspace/lanhe-skills/manifest.json

# 下载 README
echo "📥 下载 README.md..."
curl -sL "https://raw.githubusercontent.com/Marerlee/lanhe-skills/main/README.md" -o ~/.openclaw/workspace/lanhe-skills/README.md

# 创建 skills 目录
mkdir -p ~/.openclaw/workspace/lanhe-skills/skills

echo ""
echo "📁 安装完成，文件列表："
ls -la ~/.openclaw/workspace/lanhe-skills/

echo ""
echo "✅ 蓝禾技能库安装完成！"
echo ""
echo "📖 使用方式："
echo "调用技能：蓝禾技能 查询 xxx"
echo "上传技能：上传蓝禾技能"
