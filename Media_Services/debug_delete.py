#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
调试删除API - 打印接收到的请求信息
"""

from flask import Flask, request, jsonify
import json
import os

# 创建调试应用
debug_app = Flask(__name__)

@debug_app.route('/debug_delete', methods=['POST'])
def debug_delete():
    """调试删除请求"""
    try:
        data = request.get_json()
        
        print("=" * 60)
        print("收到删除请求:")
        print(f"请求数据: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        if data and 'filePaths' in data:
            file_paths = data.get('filePaths', [])
            print(f"文件路径数量: {len(file_paths)}")
            
            for i, file_path in enumerate(file_paths):
                print(f"文件 {i+1}: {file_path}")
                
                # 检查文件是否存在
                file_path_obj = os.path.abspath(file_path)
                exists = os.path.exists(file_path_obj)
                print(f"  绝对路径: {file_path_obj}")
                print(f"  文件存在: {exists}")
                
                if exists:
                    print(f"  文件大小: {os.path.getsize(file_path_obj)} 字节")
                else:
                    # 尝试在默认目录下查找
                    default_path = os.path.join("F:\\Download", file_path)
                    default_exists = os.path.exists(default_path)
                    print(f"  默认目录路径: {default_path}")
                    print(f"  默认目录存在: {default_exists}")
        
        print("=" * 60)
        
        return jsonify({
            'status': 'debug_received',
            'message': '请求已接收并记录',
            'file_count': len(file_paths) if data and 'filePaths' in data else 0
        })
        
    except Exception as e:
        print(f"调试错误: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("启动调试服务器...")
    debug_app.run(host='0.0.0.0', port=8002, debug=False)