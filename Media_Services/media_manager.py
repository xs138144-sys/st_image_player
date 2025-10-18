#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
媒体文件管理器 - 智能删除已观看的媒体文件
专为SillyTavern媒体播放器扩展设计
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

class MediaFileManager:
    """媒体文件管理器"""
    
    def __init__(self, media_directory: str, db_path: str = "media_watch_history.db"):
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
    
    def record_watch(self, file_path: str):
        """记录文件观看历史"""
        full_path = self.media_directory / file_path
        if not full_path.exists():
            return
        
        file_hash = self.calculate_file_hash(full_path)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 检查是否已存在记录
        cursor.execute(
            "SELECT watch_count FROM watch_history WHERE file_path = ?", 
            (str(file_path),)
        )
        result = cursor.fetchone()
        
        if result:
            # 更新现有记录
            cursor.execute("""
                UPDATE watch_history 
                SET watch_count = watch_count + 1, 
                    last_watch = CURRENT_TIMESTAMP
                WHERE file_path = ?
            """, (str(file_path),))
        else:
            # 插入新记录
            cursor.execute("""
                INSERT INTO watch_history 
                (file_path, file_hash, first_watch, last_watch)
                VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """, (str(file_path), file_hash))
        
        conn.commit()
        conn.close()
    
    def get_watch_statistics(self) -> Dict:
        """获取观看统计信息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                COUNT(*) as total_files,
                SUM(watch_count) as total_views,
                AVG(watch_count) as avg_views,
                MAX(watch_count) as max_views,
                COUNT(CASE WHEN watch_count = 0 THEN 1 END) as unwatched_files
            FROM watch_history
        """)
        
        result = cursor.fetchone()
        stats = {
            'total_files': result[0],
            'total_views': result[1],
            'avg_views': round(result[2] or 0, 2),
            'max_views': result[3],
            'unwatched_files': result[4]
        }
        
        conn.close()
        return stats
    
    def find_files_for_deletion(self, criteria: Dict) -> List[Dict]:
        """根据条件查找可删除的文件"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 构建查询条件
        conditions = []
        params = []
        
        if criteria.get('min_watch_count', 0) > 0:
            conditions.append("watch_count >= ?")
            params.append(criteria['min_watch_count'])
        
        if criteria.get('max_watch_count') is not None:
            conditions.append("watch_count <= ?")
            params.append(criteria['max_watch_count'])
        
        if criteria.get('older_than_days') is not None:
            cutoff_date = datetime.now() - timedelta(days=criteria['older_than_days'])
            conditions.append("last_watch <= ?")
            params.append(cutoff_date.isoformat())
        
        if criteria.get('exclude_favorites', True):
            conditions.append("is_favorite = 0")
        
        if criteria.get('only_marked', False):
            conditions.append("is_marked_for_deletion = 1")
        
        # 构建查询
        query = "SELECT file_path, watch_count, last_watch FROM watch_history"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        
        query += " ORDER BY watch_count DESC, last_watch ASC"
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        files = []
        for file_path, watch_count, last_watch in results:
            full_path = self.media_directory / file_path
            if full_path.exists():
                files.append({
                    'file_path': file_path,
                    'full_path': str(full_path),
                    'watch_count': watch_count,
                    'last_watch': last_watch,
                    'file_size': full_path.stat().st_size
                })
        
        conn.close()
        return files
    
    def mark_file_for_deletion(self, file_path: str, mark: bool = True):
        """标记/取消标记文件用于删除"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE watch_history 
            SET is_marked_for_deletion = ?
            WHERE file_path = ?
        """, (1 if mark else 0, file_path))
        
        conn.commit()
        conn.close()
    
    def delete_files(self, file_paths: List[str], backup: bool = True) -> Dict:
        """删除文件并记录日志"""
        results = {
            'success': [],
            'failed': [],
            'total_size': 0
        }
        
        backup_dir = None
        if backup:
            backup_dir = self.media_directory / "deleted_backup"
            backup_dir.mkdir(exist_ok=True)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        for file_path in file_paths:
            full_path = self.media_directory / file_path
            
            if not full_path.exists():
                results['failed'].append({'file': file_path, 'reason': '文件不存在'})
                continue
            
            try:
                file_hash = self.calculate_file_hash(full_path)
                file_size = full_path.stat().st_size
                
                # 备份文件
                if backup and backup_dir:
                    backup_path = backup_dir / f"{int(time.time())}_{full_path.name}"
                    shutil.copy2(full_path, backup_path)
                
                # 删除文件
                full_path.unlink()
                
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
                results['failed'].append({'file': file_path, 'reason': str(e)})
        
        conn.commit()
        conn.close()
        
        return results
    
    def auto_cleanup(self, criteria: Dict) -> Dict:
        """自动清理文件"""
        files_to_delete = self.find_files_for_deletion(criteria)
        
        if not files_to_delete:
            return {'status': 'no_files', 'deleted': 0, 'freed_space': 0}
        
        # 只删除前100个文件，避免一次性删除过多
        limited_files = files_to_delete[:100]
        file_paths = [f['file_path'] for f in limited_files]
        
        results = self.delete_files(file_paths, backup=True)
        
        return {
            'status': 'completed',
            'deleted': len(results['success']),
            'failed': len(results['failed']),
            'freed_space': results['total_size'],
            'details': results
        }
    
    def export_watch_history(self, output_file: str) -> bool:
        """导出观看历史到JSON文件"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT file_path, watch_count, first_watch, last_watch, is_favorite
            FROM watch_history
            ORDER BY last_watch DESC
        """)
        
        history = []
        for row in cursor.fetchall():
            history.append({
                'file_path': row[0],
                'watch_count': row[1],
                'first_watch': row[2],
                'last_watch': row[3],
                'is_favorite': bool(row[4])
            })
        
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"导出失败: {e}")
            return False
        finally:
            conn.close()

def main():
    """主函数 - 命令行界面"""
    print("=" * 60)
    print("SillyTavern 媒体文件管理器")
    print("=" * 60)
    
    # 配置媒体目录（根据你的实际目录修改）
    media_dir = input("请输入媒体目录路径（默认: F:\\Download）: ").strip()
    if not media_dir:
        media_dir = "F:\\Download"
    
    if not os.path.exists(media_dir):
        print(f"错误: 目录不存在 - {media_dir}")
        return
    
    manager = MediaFileManager(media_dir)
    
    while True:
        print("\n=== 功能菜单 ===")
        print("1. 查看观看统计")
        print("2. 查找可删除的文件")
        print("3. 手动标记文件删除")
        print("4. 执行文件删除")
        print("5. 自动清理")
        print("6. 导出观看历史")
        print("0. 退出")
        
        choice = input("请选择功能 (0-6): ").strip()
        
        if choice == "1":
            stats = manager.get_watch_statistics()
            print(f"\n📊 观看统计:")
            print(f"   总文件数: {stats['total_files']}")
            print(f"   总观看次数: {stats['total_views']}")
            print(f"   平均观看次数: {stats['avg_views']}")
            print(f"   最大观看次数: {stats['max_views']}")
            print(f"   未观看文件: {stats['unwatched_files']}")
        
        elif choice == "2":
            print("\n🔍 设置查找条件:")
            min_watch = input("最小观看次数 (默认0): ").strip()
            max_watch = input("最大观看次数 (默认不限制): ").strip()
            older_days = input("最后观看超过多少天 (默认30): ").strip()
            
            criteria = {
                'min_watch_count': int(min_watch) if min_watch else 0,
                'max_watch_count': int(max_watch) if max_watch else None,
                'older_than_days': int(older_days) if older_days else 30,
                'exclude_favorites': True
            }
            
            files = manager.find_files_for_deletion(criteria)
            print(f"\n找到 {len(files)} 个可删除文件:")
            
            for i, file_info in enumerate(files[:10], 1):  # 只显示前10个
                print(f"{i}. {file_info['file_path']}")
                print(f"   观看次数: {file_info['watch_count']}, 大小: {file_info['file_size'] // 1024}KB")
        
        elif choice == "3":
            file_path = input("请输入要标记的文件路径: ").strip()
            action = input("标记为删除? (y/n): ").strip().lower()
            
            if action == 'y':
                manager.mark_file_for_deletion(file_path, True)
                print("✓ 文件已标记为删除")
            else:
                manager.mark_file_for_deletion(file_path, False)
                print("✓ 文件取消标记")
        
        elif choice == "4":
            print("⚠️  警告: 此操作将永久删除文件!")
            confirm = input("确认删除? (输入'DELETE'确认): ").strip()
            
            if confirm == "DELETE":
                file_paths_input = input("请输入要删除的文件路径（多个用逗号分隔）: ").strip()
                file_paths = [fp.strip() for fp in file_paths_input.split(',') if fp.strip()]
                
                results = manager.delete_files(file_paths, backup=True)
                print(f"\n删除结果:")
                print(f"   成功: {len(results['success'])} 个文件")
                print(f"   失败: {len(results['failed'])} 个文件")
                print(f"   释放空间: {results['total_size'] // (1024*1024)} MB")
                
                if results['failed']:
                    print("\n失败文件:")
                    for fail in results['failed']:
                        print(f"   {fail['file']}: {fail['reason']}")
        
        elif choice == "5":
            print("\n🤖 自动清理设置:")
            older_days = input("删除最后观看超过多少天的文件 (默认90): ").strip()
            min_watch = input("最小观看次数 (默认1): ").strip()
            
            criteria = {
                'older_than_days': int(older_days) if older_days else 90,
                'min_watch_count': int(min_watch) if min_watch else 1,
                'exclude_favorites': True
            }
            
            result = manager.auto_cleanup(criteria)
            print(f"\n自动清理完成:")
            print(f"   状态: {result['status']}")
            print(f"   删除文件: {result.get('deleted', 0)}")
            print(f"   失败文件: {result.get('failed', 0)}")
            print(f"   释放空间: {result.get('freed_space', 0) // (1024*1024)} MB")
        
        elif choice == "6":
            output_file = input("请输入导出文件名 (默认: watch_history.json): ").strip()
            if not output_file:
                output_file = "watch_history.json"
            
            if manager.export_watch_history(output_file):
                print(f"✓ 观看历史已导出到 {output_file}")
            else:
                print("✗ 导出失败")
        
        elif choice == "0":
            print("感谢使用!")
            break
        
        else:
            print("无效选择，请重新输入")

if __name__ == "__main__":
    main()