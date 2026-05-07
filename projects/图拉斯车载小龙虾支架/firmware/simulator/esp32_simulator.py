#!/usr/bin/env python3
"""
ESP32 模拟端
连接到中继服务器，以"设备"身份发送消息
"""

import asyncio
import json
import websockets
import sys

SERVER_URL = "ws://你的云服务器IP:8080"  # 需要替换

async def esp32_client():
    uri = SERVER_URL

    try:
        async with websockets.connect(uri) as ws:
            # 注册为 ESP32 设备
            await ws.send(json.dumps({
                "type": "register",
                "tag": "esp32"
            }))

            reg_response = await ws.recv()
            print(f"✅ ESP32 注册成功: {reg_response}")

            # 定期发送测试消息
            test_messages = [
                "你好，我想查一下明天天气",
                "播放一首周杰伦的歌",
                "帮我记一下：今晚8点开会"
            ]

            for i, msg in enumerate(test_messages):
                print(f"\n📤 发送消息 {i+1}: {msg}")

                await ws.send(json.dumps({
                    "type": "message",
                    "to": "bridge",
                    "content": msg
                }))

                # 等待回复
                try:
                    response = await asyncio.wait_for(ws.recv(), timeout=10)
                    data = json.loads(response)
                    print(f"📥 收到回复: {data}")
                except asyncio.TimeoutError:
                    print("⏰ 等待回复超时")

                await asyncio.sleep(2)

            print("\n✅ 测试完成！按 Ctrl+C 退出")

    except websockets.exceptions.ConnectionRefused:
        print(f"❌ 连接被拒绝，请检查服务器是否运行在 {SERVER_URL}")
    except Exception as e:
        print(f"❌ 连接错误: {e}")

if __name__ == "__main__":
    if "你的云服务器IP" in SERVER_URL:
        print("⚠️ 请先编辑 SERVER_URL 为你的云服务器IP地址")
        sys.exit(1)

    asyncio.run(esp32_client())
