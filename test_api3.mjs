import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('request', r => {
        if (r.resourceType() === 'script' || r.url().includes('ting-with-efi')) {
            console.log('SCRIPT:', r.url());
        }
    });
    console.log('Going to page...');
    await page.goto('http://yuetingba.cn/book/detail/3a1c0235-9335-5f9b-b236-e3b92dda9baa/1', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2000);
    console.log('--- Clicking specific ting ---');
    try {
        await page.evaluate(() => {
            document.getElementById("iframe_tingPlay").contentWindow.testFun('3a1c0241-acb5-985c-22f9-babcfce46dfa');
        });
    } catch(e) {}
    await page.waitForTimeout(3000);
    await browser.close();
})();
