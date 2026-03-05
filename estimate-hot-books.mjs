import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

const BASE_URL = 'http://yuetingba.cn';

async function fetchBooks(categoryId, page) {
  const url = categoryId === 'latest' 
    ? `${BASE_URL}/top/latest/${page}`
    : `${BASE_URL}/book/${categoryId}/${page}`;
  
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });
  
  const $ = cheerio.load(data);
  const books = [];
  
  $('.section-box-list-item').each((_, el) => {
    const aNode = $(el).find('.box-list-item-text-title a');
    const title = aNode.text().trim();
    const href = aNode.attr('href');
    const bookId = href ? href.split('/')[3] : '';
    const cover = $(el).find('.box-list-item-img img').attr('src');
    const authorText = $(el).find('span[title]').first().text().trim();
    const speakerText = $(el).find('span[title]').last().text().trim();
    
    if (title && bookId) {
      books.push({
        title,
        bookId,
        cover: cover ? (cover.startsWith('http') ? cover : BASE_URL + cover) : '',
        author: authorText,
        speaker: speakerText
      });
    }
  });
  
  return books;
}

async function fetchBookDetail(bookId) {
  const url = `${BASE_URL}/book/detail/${bookId}/0`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });
  
  const $ = cheerio.load(data);
  
  const bookTitle = $('.feature-box-detail h1').text().trim() || $('.box-detail-item-title').text().trim();
  const cover = $('.book-info-img img, .box-detail-item-img img').attr('src');
  
  // Count chapters
  const chapters = [];
  $('.ting-list-content-item').each((_, el) => {
    const tId = $(el).attr('id')?.replace('item_', '');
    const title = $(el).find('a[title]').first().text().trim();
    if (tId && title) {
      chapters.push({ tingId: tId, title });
    }
  });
  
  // Count total pages
  const tabs = [];
  $('.nav-tabs li a').each((_, el) => {
    const tabHref = $(el).attr('href');
    const tabOffset = tabHref ? tabHref.split('/').pop() : '0';
    const tabText = $(el).text().trim();
    tabs.push({ offset: tabOffset || '0', text: tabText });
  });
  
  return {
    title: bookTitle,
    cover: cover ? BASE_URL + cover : '',
    chaptersOnPage: chapters.length,
    totalTabs: tabs.length,
    estimatedChapters: tabs.length > 1 ? tabs.length * chapters.length : chapters.length
  };
}

async function main() {
  console.log('📊 悦听吧热门书籍容量估算\n');
  console.log('==========================================\n');
  
  const categories = [
    { id: 'latest', name: '最新更新' },
    { id: '1', name: '玄幻奇幻' },
    { id: '2', name: '武侠修真' },
    { id: '3', name: '都市言情' },
  ];
  
  const allBooks = [];
  
  for (const cat of categories) {
    console.log(`📚 正在获取 [${cat.name}] 分类...`);
    
    for (let page = 1; page <= 2; page++) {
      try {
        const books = await fetchBooks(cat.id, page);
        if (books.length === 0) break;
        
        for (const book of books) {
          // 避免重复
          if (allBooks.find(b => b.bookId === book.bookId)) continue;
          
          console.log(`   📖 ${book.title}`);
          
          try {
            const detail = await fetchBookDetail(book.bookId);
            allBooks.push({
              ...book,
              category: cat.name,
              chapters: detail.estimatedChapters,
              pages: detail.totalTabs
            });
            
            // 延迟避免被封
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.log(`      ⚠️ 获取详情失败: ${e.message}`);
          }
        }
        
        // 页间延迟
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`   ⚠️ 页 ${page} 获取失败: ${e.message}`);
        break;
      }
    }
    
    console.log('');
  }
  
  // 统计结果
  console.log('\n==========================================');
  console.log('📊 统计结果');
  console.log('==========================================\n');
  
  // 按章节数排序
  allBooks.sort((a, b) => (b.chapters || 0) - (a.chapters || 0));
  
  console.log('🏆 热门书籍 Top 15 (按章节数):\n');
  console.log('| # | 书名 | 分类 | 章节 | 大小 |');
  console.log('|---|------|------|------|------|');
  
  const top15 = allBooks.slice(0, 15);
  let totalChapters = 0;
  
  top15.forEach((book, i) => {
    const sizeMB = ((book.chapters || 0) * 1.5).toFixed(0);
    totalChapters += book.chapters || 0;
    const title = book.title.length > 12 ? book.title.substring(0, 12) + '...' : book.title;
    console.log(`| ${i + 1} | ${title} | ${book.category.substring(0, 4)} | ${book.chapters || '?'} | ${sizeMB}MB |`);
  });
  
  const top15SizeGB = (totalChapters * 1.5 / 1024).toFixed(2);
  
  console.log('\n----------------------------------------');
  console.log(`📈 Top 15 统计:`);
  console.log(`   总章节: ${totalChapters} 章`);
  console.log(`   预估大小: ${top15SizeGB} GB`);
  
  // 推荐方案
  console.log('\n==========================================');
  console.log('💡 推荐同步方案 (40GB MEGA)');
  console.log('==========================================\n');
  
  // 计算能放多少本书
  const maxGB = 40;
  const avgSizePerBook = 1.5 * 200; // 平均每本书200章，每章1.5MB
  const maxBooks = Math.floor(maxGB * 1024 / avgSizePerBook);
  
  console.log(`📦 方案 A: Top 10 最热门`);
  const top10Chapters = allBooks.slice(0, 10).reduce((s, b) => s + (b.chapters || 0), 0);
  console.log(`   容量: ${(top10Chapters * 1.5 / 1024).toFixed(2)} GB`);
  console.log(`   章节: ${top10Chapters} 章`);
  console.log(`   ✅ 推荐`);
  
  console.log(`\n📦 方案 B: Top 15 最热门`);
  console.log(`   容量: ${top15SizeGB} GB`);
  console.log(`   章节: ${totalChapters} 章`);
  if (parseFloat(top15SizeGB) <= 40) {
    console.log(`   ✅ 适合 40GB 空间`);
  } else {
    console.log(`   ⚠️ 超出 40GB 限制`);
  }
  
  console.log(`\n📦 方案 C: Top 20 最热门`);
  const top20Chapters = allBooks.slice(0, 20).reduce((s, b) => s + (b.chapters || 0), 0);
  const top20GB = (top20Chapters * 1.5 / 1024).toFixed(2);
  console.log(`   容量: ${top20GB} GB`);
  console.log(`   章节: ${top20Chapters} 章`);
  if (parseFloat(top20GB) <= 40) {
    console.log(`   ✅ 适合 40GB 空间`);
  } else {
    console.log(`   ⚠️ 超出 40GB 限制`);
  }
  
  // 导出
  const dataDir = '/Users/guodong.chen/.openclaw/workspace/DreamListenBar/data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(
    `${dataDir}/hot-books.json`,
    JSON.stringify(allBooks.slice(0, 30), null, 2)
  );
  console.log('\n📄 已导出到: data/hot-books.json\n');
}

main().catch(console.error);
