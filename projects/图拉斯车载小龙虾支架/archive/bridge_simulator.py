#!/usr/bin/env python3
"""
桥接程序 模拟端
连接到中继服务器，以"桥接程序"身份接收消息
并模拟Gateway回复
"""

import asyncio
import json
import websockets

SERVER_URL = "ws://你的云服务器IP:8080"  # 需要替换

# 模拟Gateway的回复
def generate_mock_reply(message):
    """根据消息内容生成模拟回复"""
    if "天气" in message:
        return "明天天气晴朗，最高温度28度，适合出行。"
    elif "歌" in message or "音乐" in message:
        return "好的，为你播放周杰伦的《晴天》。"
    elif "记" in message or "记录" in message:
        return f"已记录：{message.replace('帮我记一下', '').replace('帮我记录', '')}。我会提醒你的。"
    else:
        return f"收到你的消息：{message}。我是模拟AI，有什么可以帮你的？"

async def bridge_client():
    uri = SERVER_URL

    try:
        async with websockets.connect(uri) as ws:
            # 注册为桥接程序
            await ws.send(json.dumps({
                "type": "register",
                "tag": "bridge"
            }))

            reg_response = await ws.recv()
            print(f"✅ 桥接程序注册成功: {reg_response}")
            print("📡 等待ESP32发来消息...\n")

            # 持续监听消息
            while True:
                try:
                    message = await ws.recv()
                    data = json.loads(message)

                    if data.get('type') == 'message':
                        content = data.get('content', '')
                        print(f"\n📥 收到ESP32消息: {content}")

                        # 生成模拟回复
                        reply = generate_mock_reply(content)
                        print(f"🤖 模拟Gateway回复: {reply}")

                        # 发回给ESP32
                        await ws.send(json.dumps({
                            "type": "message",
                            "to": "esp32",
                            "content": reply
                        }))
                        print(f"📤 已发送回复给ESP32")

                except json.JSONDecodeError:
                    print(f"⚠️ 收到无法解析的消息: {message}")

    except websockets.exceptions.ConnectionRefused:
        print(f"❌ 连接被拒绝，请检查服务器是否运行在 {SERVER_URL}")
    except Exception as e:
        print(f"❌ 连接错误: {e}")

if __name__ == "__main__":
    if "你的云服务器IP" in SERVER_URL:
        print("⚠️ 请先编辑 SERVER_URL 为你的云服务器IP地址")
        import sys
        sys.exit(1)

    asyncio.run(bridge_client())
