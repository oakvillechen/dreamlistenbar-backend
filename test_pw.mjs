import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('request', req => {
        console.log(`REQ: ${req.url()}`);
    });
    
    page.on('response', async res => {
        const type = res.request().resourceType();
        if (type === 'fetch' || type === 'xhr') {
             try {
                 const text = await res.text();
                 console.log(`RES [${res.url()}]: ${text.substring(0, 100)}`);
             } catch(e) {}
        }
    });

    try {
        await page.goto('http://yuetingba.cn/book/detail/3a1c0235-9335-5f9b-b236-e3b92dda9baa/1', { waitUntil: 'load', timeout: 5000 });
        await page.waitForTimeout(2000);
        console.log("HTML Start:", (await page.content()).substring(0, 500));
        await page.waitForTimeout(2000);
    } catch(e) {
        console.error("ERR:", e.message);
    }
    await browser.close();
})();
