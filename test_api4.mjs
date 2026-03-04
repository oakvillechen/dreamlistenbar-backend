import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('request', r => {
        if (r.url().includes('audioSrc') || r.resourceType() === 'media' || r.url().match(/\.(mp3|m4a|m3u8)/)) {
            console.log('REQ:', r.url());
        }
    });
    // load player directly
    await page.goto('http://yuetingba.cn/tingpage/index.html?v=1.7.5#/pages/book/bookplay?v=1.7.5', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2000);
    console.log('--- Calling window.testFun ---');
    try {
        await page.evaluate(() => {
            window.testFun('3a1c0241-acb5-985c-22f9-babcfce46dfa');
        });
    } catch(e) { console.error('Error invoking testFun:', e.message); }
    await page.waitForTimeout(3000);
    await browser.close();
})();
