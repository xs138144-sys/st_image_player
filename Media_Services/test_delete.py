#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试删除API
"""

import requests
import json

# 测试删除API
def test_delete_api():
    # 测试文件路径（使用一个实际存在的文件）
    test_file_paths = [
        "F:\\Download\\test_file.txt"  # 请确保这个文件存在
    ]
    
    # 发送删除请求
    response = requests.post(
        'http://localhost:8001/delete_files',
        headers={'Content-Type': 'application/json'},
        json={
            'filePaths': test_file_paths,
            'backup': True
        }
    )
    
    print(f"状态码: {response.status_code}")
    print(f"响应内容: {response.text}")
    
    if response.status_code == 200:
        result = response.json()
        print(f"删除结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
        
        # 检查备份目录
        import os
        backup_dir = "F:\\Download\\deleted_backup"
        if os.path.exists(backup_dir):
            print(f"备份目录内容: {os.listdir(backup_dir)}")
        else:
            print("备份目录不存在")
    else:
        print(f"删除失败: {response.text}")

if __name__ == '__main__':
    test_delete_api()