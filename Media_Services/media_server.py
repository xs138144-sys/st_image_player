#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
媒体文件管理Web服务
为SillyTavern媒体播放器扩展提供文件删除API
"""

import os
import json
import time
import shutil
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
from typing import List, Dict, Set
import hashlib
from flask import Flask, request, jsonify
from flask_cors import CORS

class MediaFileManager:
    """媒体文件管理器"""
    
    def __init__(self, media_directory: str = "F:\\Download", db_path: str = "media_watch_history.db"):
        self.media_directory = Path(media_directory)
        self.db_path = Path(db_path)
        self._init_database()
    
    def _init_database(self):
        """初始化数据库"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建观看历史表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS watch_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE,
                file_hash TEXT,
                watch_count INTEGER DEFAULT 1,
                first_watch TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_watch TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_favorite BOOLEAN DEFAULT 0,
                is_marked_for_deletion BOOLEAN DEFAULT 0,
                user_rating INTEGER DEFAULT 0
            )
        """)
        
        # 创建删除日志表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS deletion_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT,
                file_hash TEXT,
                deletion_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason TEXT
            )
        """)
        
        conn.commit()
        conn.close()
    
    def calculate_file_hash(self, file_path: Path) -> str:
        """计算文件哈希值"""
        try:
            with open(file_path, 'rb') as f:
                return hashlib.md5(f.read()).hexdigest()
        except Exception as e:
            print(f"计算文件哈希失败 {file_path}: {e}")
            return ""
    
    def delete_files(self, file_paths: List[str], backup: bool = True) -> Dict:
        """删除文件并记录日志"""
        results = {
            'success': [],
            'failed': [],
            'total_size': 0
        }
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        for file_path in file_paths:
            # 处理文件路径：如果是绝对路径直接使用，否则拼接默认目录
            file_path_obj = Path(file_path)
            if file_path_obj.is_absolute():
                full_path = file_path_obj
            else:
                full_path = self.media_directory / file_path
            
            if not full_path.exists():
                results['failed'].append({'file': str(file_path), 'reason': f'文件不存在: {full_path}'})
                continue
            
            try:
                file_hash = self.calculate_file_hash(full_path)
                file_size = full_path.stat().st_size
                
                # 使用send2trash将文件移动到回收站
                import send2trash
                send2trash.send2trash(str(full_path))
                
                # 记录删除日志
                cursor.execute("""
                    INSERT INTO deletion_log (file_path, file_hash, reason)
                    VALUES (?, ?, '用户手动删除')
                """, (file_path, file_hash))
                
                results['success'].append({
                    'file': file_path,
                    'size': file_size
                })
                results['total_size'] += file_size
                
            except Exception as e:
                results['failed'].append({'file': str(file_path), 'reason': f'{str(e)} - 文件路径: {full_path}'})
        
        conn.commit()
        conn.close()
        
        return results

# 创建Flask应用
app = Flask(__name__)
CORS(app)  # 允许跨域请求

# 初始化文件管理器
media_manager = MediaFileManager()

@app.route('/')
def index():
    """首页"""
    return jsonify({
        'status': 'running',
        'service': 'Media File Manager API',
        'version': '1.0.0',
        'endpoints': {
            '/delete_files': 'POST - 批量删除文件',
            '/health': 'GET - 健康检查'
        }
    })

@app.route('/health')
def health():
    """健康检查"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

@app.route('/delete_files', methods=['POST'])
def delete_files():
    """批量删除文件API"""
    try:
        data = request.get_json()
        
        if not data or 'filePaths' not in data:
            return jsonify({
                'error': '缺少必要参数',
                'required': ['filePaths']
            }), 400
        
        file_paths = data.get('filePaths', [])
        backup = data.get('backup', True)
        
        if not isinstance(file_paths, list) or len(file_paths) == 0:
            return jsonify({
                'error': 'filePaths必须是非空数组'
            }), 400
        
        # 执行删除操作
        results = media_manager.delete_files(file_paths, backup=backup)
        
        return jsonify({
            'status': 'completed',
            'success': len(results['success']),
            'failed': len(results['failed']),
            'total_size': results['total_size'],
            'details': results
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500

if __name__ == '__main__':
    print("=" * 60)
    print("SillyTavern 媒体文件管理Web服务")
    print("服务地址: http://localhost:8001")
    print("=" * 60)
    
    # 启动Web服务
    app.run(host='0.0.0.0', port=8001, debug=False)