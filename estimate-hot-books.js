const axios = require('axios');
const cheerio = require('cheerio');

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
    
    for (let page = 1; page <= 3; page++) {
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
            await new Promise(r => setTimeout(r, 500));
          } catch (e) {
            console.log(`      ⚠️ 获取详情失败: ${e.message}`);
          }
        }
        
        // 页间延迟
        await new Promise(r => setTimeout(r, 1000));
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
  
  console.log('🏆 热门书籍 Top 20 (按章节数):\n');
  console.log('| # | 书名 | 分类 | 章节数 | 预估大小 |');
  console.log('|---|------|------|--------|----------|');
  
  const top20 = allBooks.slice(0, 20);
  let totalChapters = 0;
  
  top20.forEach((book, i) => {
    const sizeMB = ((book.chapters || 0) * 1.5).toFixed(0);
    totalChapters += book.chapters || 0;
    console.log(`| ${i + 1} | ${book.title.substring(0, 15)} | ${book.category} | ${book.chapters || '?'} | ${sizeMB} MB |`);
  });
  
  const top20SizeGB = (totalChapters * 1.5 / 1024).toFixed(2);
  
  console.log('\n----------------------------------------');
  console.log(`📈 Top 20 书籍统计:`);
  console.log(`   总章节: ${totalChapters} 章`);
  console.log(`   预估大小: ${top20SizeGB} GB`);
  console.log(`   平均每书: ${(totalChapters / 20).toFixed(0)} 章`);
  
  // 全部书籍统计
  const allChapters = allBooks.reduce((sum, b) => sum + (b.chapters || 0), 0);
  const allSizeGB = (allChapters * 1.5 / 1024).toFixed(2);
  
  console.log('\n----------------------------------------');
  console.log(`📊 全部获取书籍统计:`);
  console.log(`   书籍数量: ${allBooks.length} 本`);
  console.log(`   总章节: ${allChapters} 章`);
  console.log(`   预估大小: ${allSizeGB} GB`);
  
  // 推荐方案
  console.log('\n==========================================');
  console.log('💡 推荐同步方案');
  console.log('==========================================\n');
  
  console.log('方案 A: 仅 Top 10 热门书籍');
  const top10Chapters = allBooks.slice(0, 10).reduce((s, b) => s + (b.chapters || 0), 0);
  console.log(`   容量: ${(top10Chapters * 1.5 / 1024).toFixed(2)} GB`);
  console.log(`   章节: ${top10Chapters} 章`);
  console.log(`   ✅ 适合 40GB MEGA 免费空间\n`);
  
  console.log('方案 B: Top 20 热门书籍');
  console.log(`   容量: ${top20SizeGB} GB`);
  console.log(`   章节: ${totalChapters} 章`);
  console.log(`   ✅ 适合 40GB MEGA 免费空间\n`);
  
  console.log('方案 C: Top 50 热门书籍');
  const top50Chapters = allBooks.slice(0, 50).reduce((s, b) => s + (b.chapters || 0), 0);
  const top50SizeGB = (top50Chapters * 1.5 / 1024).toFixed(2);
  console.log(`   容量: ${top50SizeGB} GB`);
  console.log(`   章节: ${top50Chapters} 章`);
  if (parseFloat(top50SizeGB) > 40) {
    console.log(`   ⚠️ 超出 40GB 限制，需要筛选`);
  }
  
  // 输出 JSON 供后续使用
  console.log('\n==========================================');
  console.log('📄 导出书籍列表到文件...');
  const fs = require('fs');
  fs.writeFileSync(
    '/Users/guodong.chen/.openclaw/workspace/DreamListenBar/data/hot-books.json',
    JSON.stringify(allBooks.slice(0, 50), null, 2)
  );
  console.log('   ✅ 已保存到 data/hot-books.json\n');
}

main().catch(console.error);
