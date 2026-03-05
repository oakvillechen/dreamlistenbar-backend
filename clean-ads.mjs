import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '..', 'downloads', '仙逆', 'audio');
const URL_FILE = path.join(__dirname, '..', 'downloads', '仙逆', 'audio-urls-from-1250.json');

// 1. 删除小于 1MB 的可疑音频文件
console.log('🧹 开始清理小于 1MB 的可疑音频文件 (广告)...');
let deletedCount = 0;

if (fs.existsSync(AUDIO_DIR)) {
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  
  for (const file of files) {
    const filePath = path.join(AUDIO_DIR, file);
    const stats = fs.statSync(filePath);
    
    // 小于 1MB (1 * 1024 * 1024 bytes) = 广告
    if (stats.size < 1048576) {
      fs.unlinkSync(filePath);
      deletedCount++;
      // console.log(`   [-删] ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
    }
  }
}
console.log(`✅ 已删除 ${deletedCount} 个垃圾/广告音频。`);

// 2. 清理 JSON 中的错误 URL
console.log('\n🔄 正在重置 JSON 数据...');
if (fs.existsSync(URL_FILE)) {
  const chapters = JSON.parse(fs.readFileSync(URL_FILE, 'utf-8'));
  let resetCount = 0;
  
  for (const chapter of chapters) {
    if (chapter.audioUrl) {
      const url = chapter.audioUrl.toLowerCase();
      // 如果链接是 YouTube 系的 CDN (广告源)
      if (url.includes('gvt1.com') || url.includes('googlevideo.com') || url.includes('youtube.com')) {
        chapter.audioUrl = null;
        resetCount++;
      }
    }
  }
  
  fs.writeFileSync(URL_FILE, JSON.stringify(chapters, null, 2));
  console.log(`✅ 已重置 ${resetCount} 个广告 URL 为待抓取状态。`);
} else {
  console.log('⚠️ 未找到 JSON 文件，跳过重置。');
}
