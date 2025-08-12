const { GoLogin } = require('gologin');
const puppeteer = require('puppeteer-core');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

let browser;
let page;
let gologin;

// Headless toggle via ENV
const HEADLESS_ENV = (process.env.HEADLESS || 'false').toLowerCase();
const IS_HEADLESS = HEADLESS_ENV === 'true' || HEADLESS_ENV === '1' || HEADLESS_ENV === 'yes';

const GOLOGIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ODY5ZWZiYmJhZWFhYmU0ZjNjYmU1NjAiLCJ0eXBlIjoiZGV2Iiwiand0aWQiOiI2ODY5ZjA2MmM2ZDBmMmM2MmQ4YTliYWYifQ.8-pL-goXMs-7e_H7Rb3CcEh017ztWiyoMgqKX8yZgOo';
const PROFILE_ID = '6869eff066690ae8297cac35';

// Đường dẫn lưu user data
const USER_DATA_DIR = path.join(__dirname, 'user-data');
const SESSION_FILE = path.join(USER_DATA_DIR, 'canva-session.json');

// Tạo thư mục user-data nếu chưa có
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    console.log('✓ Đã tạo thư mục user-data');
}
// Force using pure Puppeteer headless (skip GoLogin connect) when requested
const HEADLESS_FORCE_PURE = (process.env.HEADLESS_FORCE_PURE || 'false').toLowerCase() === 'true';
// Extra params for GoLogin start (space-separated), e.g. "--headless=new --disable-gpu"
const GOLOGIN_EXTRA_PARAMS = (process.env.GOLOGIN_EXTRA_PARAMS || '').trim();
function parseExtraParams(str) {
    if (!str) return [];
    // naive split by space respecting quoted strings could be added; keep simple
    return str.split(/\s+/).filter(Boolean);
}


// Hàm lưu session data
async function saveSessionData(page) {
    try {
        console.log('Đang lưu session data...');

        // Lấy cookies
        const cookies = await page.cookies();

        // Lấy localStorage
        const localStorage = await page.evaluate(() => {
            const data = {};
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                data[key] = window.localStorage.getItem(key);
            }
            return data;
        });

        // Lấy sessionStorage
        const sessionStorage = await page.evaluate(() => {
            const data = {};
            for (let i = 0; i < window.sessionStorage.length; i++) {
                const key = window.sessionStorage.key(i);
                data[key] = window.sessionStorage.getItem(key);
            }
            return data;
        });

        const sessionData = {
            cookies,
            localStorage,
            sessionStorage,
            timestamp: Date.now(),
            url: await page.url(),
            userAgent: await page.evaluate(() => navigator.userAgent),
            viewport: await page.viewport()
        };

        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));

        // Lưu riêng cookies để dễ sử dụng
        const cookiesFile = path.join(USER_DATA_DIR, 'canva-cookies.json');
        const cookieData = {
            cookies,
            timestamp: Date.now(),
            domain: 'www.canva.com'
        };
        fs.writeFileSync(cookiesFile, JSON.stringify(cookieData, null, 2));

        console.log('✓ Đã lưu session data và cookies thành công');
        console.log(`✓ Session file: ${SESSION_FILE}`);
        console.log(`✓ Cookies file: ${cookiesFile}`);

    } catch (error) {
        console.log('Lỗi khi lưu session data:', error.message);
    }
}

// Hàm khôi phục session data
async function restoreSessionData(page) {
    try {
        if (!fs.existsSync(SESSION_FILE)) {
            console.log('Không tìm thấy session data đã lưu');
            return false;
        }

        console.log('Đang khôi phục session data...');
        const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

        // Kiểm tra session có quá cũ không (7 ngày)
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 ngày
        if (Date.now() - sessionData.timestamp > maxAge) {
            console.log('Session data đã quá cũ, bỏ qua khôi phục');
            return false;
        }

        // Điều hướng đến trang Canva trước với timeout
        try {
            console.log('🌐 Điều hướng đến Canva để khôi phục session...');
            await page.goto('https://www.canva.com', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });
            console.log('✓ Đã điều hướng đến Canva');
        } catch (error) {
            console.log('⚠️ Lỗi điều hướng đến Canva:', error.message);
            console.log('🔄 Thử với timeout ngắn hơn...');

            try {
                await page.goto('https://www.canva.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });
                console.log('✓ Đã điều hướng đến Canva (fallback)');
            } catch (fallbackError) {
                console.log('❌ Không thể điều hướng đến Canva, bỏ qua khôi phục session');
                return false;
            }
        }

        // Khôi phục cookies
        if (sessionData.cookies && sessionData.cookies.length > 0) {
            await page.setCookie(...sessionData.cookies);
            console.log('✓ Đã khôi phục cookies');
        }

        // Khôi phục localStorage
        if (sessionData.localStorage) {
            await page.evaluate((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value);
                }
            }, sessionData.localStorage);
            console.log('✓ Đã khôi phục localStorage');
        }

        // Khôi phục sessionStorage
        if (sessionData.sessionStorage) {
            await page.evaluate((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.sessionStorage.setItem(key, value);
                }
            }, sessionData.sessionStorage);
            console.log('✓ Đã khôi phục sessionStorage');
        }

        // Refresh trang để áp dụng session
        await page.reload({ waitUntil: 'networkidle0' });
        console.log('✓ Đã khôi phục session data thành công');

        return true;

    } catch (error) {
        console.log('Lỗi khi khôi phục session data:', error.message);
        return false;
    }
}

// Hàm load cookies riêng biệt
async function loadCookiesOnly(page) {
    try {
        const cookiesFile = path.join(USER_DATA_DIR, 'canva-cookies.json');

        if (!fs.existsSync(cookiesFile)) {
            console.log('Không tìm thấy file cookies');
            return false;
        }

        console.log('Đang load cookies...');
        const cookieData = JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));

        // Kiểm tra cookies có quá cũ không (3 ngày)
        const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 ngày
        if (Date.now() - cookieData.timestamp > maxAge) {
            console.log('Cookies đã quá cũ, bỏ qua load');
            return false;
        }

        // Điều hướng đến trang Canva trước
        await page.goto('https://www.canva.com', { waitUntil: 'networkidle0' });

        // Load cookies
        if (cookieData.cookies && cookieData.cookies.length > 0) {
            await page.setCookie(...cookieData.cookies);
            console.log(`✓ Đã load ${cookieData.cookies.length} cookies`);

            // Refresh trang để áp dụng cookies
            await page.reload({ waitUntil: 'networkidle0' });
            return true;
        }

        return false;

    } catch (error) {
        console.log('Lỗi khi load cookies:', error.message);
        return false;
    }
}

// Hàm xóa session data cũ
function clearSessionData() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            fs.unlinkSync(SESSION_FILE);
            console.log('✓ Đã xóa session data cũ');
        }

        const cookiesFile = path.join(USER_DATA_DIR, 'canva-cookies.json');
        if (fs.existsSync(cookiesFile)) {
            fs.unlinkSync(cookiesFile);
            console.log('✓ Đã xóa cookies cũ');
        }
    } catch (error) {
        console.log('Lỗi khi xóa session data:', error.message);
    }
}

async function initializeGologinBrowser(profileId = PROFILE_ID) {
    try {
        // Đóng browser cũ nếu có
        if (browser && browser.isConnected()) {
            console.log('Đóng trình duyệt GoLogin cũ...');
            try {
                await browser.close();
                if (gologin) {
                    await gologin.stop();
                }
            } catch (error) {
                console.log('Lỗi khi đóng trình duyệt cũ:', error.message);
            }
        }

        console.log('Đang khởi tạo GoLogin với SDK...');

        // Kiểm tra Chrome path trước
        const chromePath = await getChromePath();
        console.log('Chrome path:', chromePath);

        // Nếu ép chạy headless thuần Puppeteer, bỏ qua GoLogin connect
        if (HEADLESS_FORCE_PURE && IS_HEADLESS) {
            console.log('⚙️ HEADLESS_FORCE_PURE bật: bỏ qua GoLogin, chạy Puppeteer headless thuần.');
            browser = await puppeteer.launch({
                headless: true,
                executablePath: chromePath,
                args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
            });
            page = await browser.newPage();
            return { browser, page };
        }

        // Kiểm tra token và profile ID
        console.log('GoLogin Token:', GOLOGIN_TOKEN ? 'Có' : 'Không có');
        console.log('Profile ID:', profileId);

        // Sử dụng GoLogin SDK với cấu hình đơn giản
        gologin = new GoLogin({
            token: GOLOGIN_TOKEN,
            profile_id: profileId,
            executablePath: chromePath,
            skipOrbitaHashChecking: true,
            skipFontsChecking: true,
            skipFontsLoading: true,
        });

        console.log('Đang khởi động profile GoLogin...');

        // Thêm timeout cho việc khởi động GoLogin (tôn trọng chế độ headless từ ENV)
        const startOptions = {
            headless: IS_HEADLESS,
            // extra_params ưu tiên từ ENV, sau đó thêm headless flags nếu IS_HEADLESS
            extra_params: [
                ...parseExtraParams(GOLOGIN_EXTRA_PARAMS),
                ...(IS_HEADLESS ? ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage'] : [])
            ]
        };
        const startPromise = gologin.start(startOptions);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: GoLogin start took too long (60s)')), 60000);
        });

        const { status, wsUrl } = await Promise.race([startPromise, timeoutPromise]);

        if (status !== 'success') {
            console.log(`⚠️ GoLogin không thể khởi động: ${status}, fallback sang Puppeteer...`);
            throw new Error(`GoLogin không thể khởi động: ${status}`);
        }

        console.log('✓ GoLogin profile đã khởi động thành công');
        console.log('WebSocket URL:', wsUrl);

        console.log('Kết nối với trình duyệt GoLogin...');

        // Retry connection với timeout
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔌 Thử kết nối lần ${attempt}/${maxRetries}...`);

                browser = await puppeteer.connect({
                    browserWSEndpoint: wsUrl,
                    ignoreHTTPSErrors: true,
                });

                console.log('✅ Kết nối thành công với GoLogin browser! (Chế độ hiển thị/ẩn phụ thuộc vào cấu hình profile GoLogin)');
                break;

            } catch (error) {
                console.log(`❌ Kết nối lần ${attempt} thất bại:`, error.message);

                if (attempt === maxRetries) {
                    throw new Error(`Không thể kết nối với GoLogin browser sau ${maxRetries} lần thử: ${error.message}`);
                }

                // Chờ trước khi thử lại
                console.log(`⏳ Chờ ${attempt * 2} giây trước khi thử lại...`);
                await sleep(attempt * 2000);
            }
        }

        // CRITICAL FIX: Đóng tab thừa và chỉ giữ 1 tab
        const pages = await browser.pages();
        console.log(`🔍 Tìm thấy ${pages.length} tabs, đóng tab thừa để tiết kiệm tài nguyên...`);

        // Đóng tất cả tab trừ tab đầu tiên
        for (let i = 1; i < pages.length; i++) {
            try {
                await pages[i].close();
                console.log(`✅ Đã đóng tab thừa ${i + 1}`);
            } catch (closeError) {
                console.log(`⚠️ Không thể đóng tab ${i + 1}:`, closeError.message);
            }
        }

        if (pages.length > 0) {
            page = pages[0];
            console.log(`✓ Đã kết nối với page đầu tiên (giữ lại 1/${pages.length} tabs)`);
        } else {
            page = await browser.newPage();
            console.log('✓ Đã tạo page mới');
        }

        // Set viewport
        await page.setViewport({
            width: 1366,
            height: 768
        });

        // Thử khôi phục session data nếu có
        console.log('Kiểm tra session data đã lưu...');
        const sessionRestored = await restoreSessionData(page);

        if (sessionRestored) {
            console.log('✓ Đã khôi phục session data thành công');
        } else {
            console.log('Không có session data hoặc không thể khôi phục');
        }

        console.log('✓ GoLogin browser đã khởi tạo thành công');
        console.log('Profile ID:', gologin.profile_id);

        // Set global variable for compatibility functions
        currentGoLoginBrowser = {
            humanClick: async (selector, options = {}) => {
                await page.waitForSelector(selector, { visible: true, timeout: 10000 });
                await sleep(Math.random() * 500 + 200);
                await page.click(selector);
                return true;
            },
            humanType: async (selector, text, options = {}) => {
                await page.waitForSelector(selector, { visible: true, timeout: 10000 });
                await page.click(selector);
                await page.keyboard.down('Control');
                await page.keyboard.press('KeyA');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                const delay = options.delay || Math.random() * 50 + 50;
                await page.type(selector, text, { delay });
                return true;
            },
            humanScroll: async () => {
                await page.evaluate(() => {
                    window.scrollBy(0, Math.random() * 300 + 100);
                });
                await sleep(Math.random() * 1000 + 500);
            },
            randomMouseMovement: async () => {
                const x = Math.random() * 800 + 100;
                const y = Math.random() * 600 + 100;
                await page.mouse.move(x, y, { steps: 10 });
                await sleep(Math.random() * 500 + 200);
            },
            navigateWithRetry: async (url, maxRetries = 3) => {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
                        return true;
                    } catch (error) {
                        if (attempt === maxRetries) throw error;
                        await sleep(2000 * attempt);
                    }
                }
            }
        };

        return { browser, page, gologin };

    } catch (error) {
        console.error('❌ Lỗi khởi tạo GoLogin:', error.message);
        console.log('🔄 Thử sử dụng Puppeteer thông thường làm fallback...');

        try {
            // Fallback: Sử dụng Puppeteer thông thường
            const puppeteer = require('puppeteer');

            // Tìm Chrome path trực tiếp
            const fs = require('fs');
            let chromePath = null;

            const possiblePaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
            ];

            for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                    chromePath = path;
                    break;
                }
            }

            if (!chromePath) {
                throw new Error('Không tìm thấy Chrome executable');
            }

            console.log('🚀 Khởi động Puppeteer với Chrome tại:', chromePath, '| headless =', IS_HEADLESS);

            browser = await puppeteer.launch({
                headless: IS_HEADLESS,
                executablePath: chromePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-extensions',
                    '--no-default-browser-check'
                ],
                defaultViewport: null,
                ignoreDefaultArgs: ['--enable-automation'],
                ignoreHTTPSErrors: true
            });

            // Lấy page đầu tiên hoặc tạo mới
            const pages = await browser.pages();
            if (pages.length > 0) {
                page = pages[0];
            } else {
                page = await browser.newPage();
            }

            // Set viewport
            await page.setViewport({
                width: 1366,
                height: 768
            });

            console.log('✅ Đã khởi tạo Puppeteer thông thường thành công (fallback)');

            return { browser, page };

        } catch (fallbackError) {
            console.error('❌ Fallback Puppeteer cũng thất bại:', fallbackError.message);
            throw new Error(`Cả GoLogin và Puppeteer đều thất bại. GoLogin: ${error.message}, Puppeteer: ${fallbackError.message}`);
        }
    }
}

async function getChromePath() {
    const fs = require('fs');

    // Danh sách các path có thể có Chrome
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Chromium\\Application\\chrome.exe',
    ];

    // Thử tìm Chrome trong các path thông thường
    for (const path of paths) {
        if (fs.existsSync(path)) {
            console.log('✓ Tìm thấy Chrome tại:', path);
            return path;
        }
    }

    // Thử sử dụng puppeteer executablePath
    try {
        const { executablePath } = require('puppeteer');
        const puppeteerPath = executablePath();
        if (fs.existsSync(puppeteerPath)) {
            console.log('✓ Sử dụng Puppeteer Chrome tại:', puppeteerPath);
            return puppeteerPath;
        }
    } catch (error) {
        console.log('Puppeteer executablePath không hoạt động:', error.message);
    }

    // Nếu không tìm thấy, thử download Chrome qua puppeteer
    try {
        console.log('🔄 Đang download Chrome qua Puppeteer...');
        const puppeteer = require('puppeteer');
        const browserFetcher = puppeteer.createBrowserFetcher();
        const revisionInfo = await browserFetcher.download('1069273'); // Chrome stable version

        if (fs.existsSync(revisionInfo.executablePath)) {
            console.log('✓ Đã download Chrome tại:', revisionInfo.executablePath);
            return revisionInfo.executablePath;
        }
    } catch (error) {
        console.log('Không thể download Chrome:', error.message);
    }

    throw new Error('Không tìm thấy Chrome executable. Vui lòng cài đặt Google Chrome.');
}

async function closeBrowser() {
    try {
        // Lưu session data trước khi đóng
        if (page && browser && browser.isConnected()) {
            console.log('Lưu session data trước khi đóng...');
            await saveSessionData(page);
        }

        if (browser && browser.isConnected()) {
            await browser.close();
        }
        if (gologin) {
            await gologin.stop();
        }
        console.log('✓ Đã đóng GoLogin browser');
    } catch (error) {
        console.error('Lỗi khi đóng browser:', error.message);
    }
}

function getBrowser() {
    return browser;
}

function getPage() {
    return page;
}

function getGologin() {
    return gologin;
}

// Hàm HTTP request đơn giản
function makeHttpRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(responseData);
                    resolve(jsonData);
                } catch (error) {
                    resolve(responseData);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// Hàm sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Global variable to store current browser instance
let currentGoLoginBrowser = null;

// Add missing functions for compatibility
async function humanClick(selector, options = {}) {
    if (currentGoLoginBrowser) {
        return await currentGoLoginBrowser.humanClick(selector, options);
    }
    throw new Error('GoLogin browser not initialized');
}

async function humanType(selector, text, options = {}) {
    if (currentGoLoginBrowser) {
        return await currentGoLoginBrowser.humanType(selector, text, options);
    }
    throw new Error('GoLogin browser not initialized');
}

async function humanScroll() {
    if (currentGoLoginBrowser) {
        return await currentGoLoginBrowser.humanScroll();
    }
    throw new Error('GoLogin browser not initialized');
}

async function randomMouseMovement() {
    if (currentGoLoginBrowser) {
        return await currentGoLoginBrowser.randomMouseMovement();
    }

    // Fallback cho Puppeteer thông thường
    if (currentBrowser && currentPage) {
        try {
            // Tạo random mouse movement đơn giản
            const viewport = await currentPage.viewport();
            const x = Math.random() * (viewport.width - 100) + 50;
            const y = Math.random() * (viewport.height - 100) + 50;

            await currentPage.mouse.move(x, y, { steps: 10 });
            await new Promise(resolve => setTimeout(resolve, 100));

            return true;
        } catch (error) {
            console.log('Lỗi random mouse movement:', error.message);
            return false;
        }
    }

    console.log('⚠️ Không có browser để thực hiện mouse movement');
    return false;
}

async function navigateWithRetry(url, maxRetries = 3) {
    if (currentGoLoginBrowser) {
        return await currentGoLoginBrowser.navigateWithRetry(url, maxRetries);
    }
    throw new Error('GoLogin browser not initialized');
}

module.exports = {
    initializeGologinBrowser,
    closeBrowser,
    getBrowser,
    getPage,
    getGologin,
    saveSessionData,
    restoreSessionData,
    loadCookiesOnly,
    clearSessionData,
    humanClick,
    humanType,
    humanScroll,
    randomMouseMovement,
    navigateWithRetry,
    sleep
};
