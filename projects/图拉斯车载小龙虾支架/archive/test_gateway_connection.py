#!/usr/bin/env python3
"""
桥接程序 连接 Gateway 测试
验证桥接程序能否成功连接到 Gateway WebSocket
"""

import asyncio
import json
import websockets
import random
import string

GATEWAY_URL = "ws://127.0.0.1:18789"

def generate_nonce(length=16):
    """生成随机nonce"""
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

async def test_gateway_connection():
    print("🔌 测试连接到 Gateway...\n")
    print(f"目标地址: {GATEWAY_URL}")

    try:
        async with websockets.connect(GATEWAY_URL) as ws:
            print("✅ WebSocket 连接成功！\n")

            # 等待 Gateway 的 connect.challenge
            print("📥 等待 Gateway 挑战...")
            challenge = await asyncio.wait_for(ws.recv(), timeout=5)
            challenge_data = json.loads(challenge)
            print(f"收到挑战: {json.dumps(challenge_data, indent=2)}\n")

            # 检查挑战格式
            if challenge_data.get('type') == 'event' and challenge_data.get('event') == 'connect.challenge':
                nonce = challenge_data.get('payload', {}).get('nonce')
                ts = challenge_data.get('payload', {}).get('ts')
                print(f"✅ 挑战验证通过 (nonce: {nonce}, ts: {ts})\n")
            else:
                print(f"⚠️ 意外的挑战格式: {challenge_data}\n")

            # 发送 connect 请求
            print("📤 发送 connect 请求...")
            connect_request = {
                "type": "req",
                "id": "test-001",
                "method": "connect",
                "params": {
                    "minProtocol": 3,
                    "maxProtocol": 3,
                    "client": {
                        "id": "bridge-tester",
                        "version": "1.0.0",
                        "platform": "test",
                        "mode": "node"
                    },
                    "role": "node",
                    "scopes": ["node.message"],
                    "caps": [],
                    "commands": [],
                    "permissions": {},
                    "locale": "zh-CN",
                    "userAgent": "bridge-tester/1.0.0"
                }
            }

            await ws.send(json.dumps(connect_request))
            print(f"已发送: {json.dumps(connect_request, indent=2)}\n")

            # 等待响应
            print("📥 等待 Gateway 响应...")
            response = await asyncio.wait_for(ws.recv(), timeout=5)
            response_data = json.loads(response)
            print(f"收到响应: {json.dumps(response_data, indent=2)}\n")

            # 检查是否成功
            if response_data.get('type') == 'res' and response_data.get('ok'):
                payload = response_data.get('payload', {})
                if payload.get('type') == 'hello-ok':
                    print("🎉 **连接成功！** Gateway 接受了桥接程序的连接！")
                    print(f"   protocol: {payload.get('protocol')}")
                    print(f"   serverName: {payload.get('serverName', 'N/A')}")
                else:
                    print(f"⚠️ 意外的响应类型: {payload}")
            elif response_data.get('type') == 'res' and not response_data.get('ok'):
                print(f"❌ 连接被拒绝: {response_data.get('error')}")
            else:
                print(f"⚠️ 意外的响应格式: {response_data}")

    except websockets.exceptions.ConnectionRefused:
        print(f"\n❌ 连接被拒绝！")
        print(f"   Gateway 可能没有运行在 {GATEWAY_URL}")
        print(f"   请检查 Gateway 状态: openclaw gateway status")
    except asyncio.TimeoutError:
        print(f"\n⏰ 等待响应超时！")
        print(f"   Gateway 可能没有返回预期的消息")
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_gateway_connection())
