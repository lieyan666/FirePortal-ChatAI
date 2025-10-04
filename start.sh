#!/bin/bash

# 启动脚本

START_TIME=$(date +%s)
echo "=========================================="
echo "启动时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "正在拉取最新代码..."
STEP_START=$(date +%s)
git pull
STEP_END=$(date +%s)
echo "✓ 拉取完成 (耗时: $((STEP_END - STEP_START))秒)"

echo ""
echo "正在安装依赖..."
STEP_START=$(date +%s)
npm install
STEP_END=$(date +%s)
echo "✓ 依赖安装完成 (耗时: $((STEP_END - STEP_START))秒)"

echo ""
echo "正在启动服务..."
STEP_START=$(date +%s)
echo "服务启动时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

npm start
