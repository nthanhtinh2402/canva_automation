# Canva Automation — Hướng dẫn cài đặt và sử dụng

Tự động mời thành viên vào Canva (1 tháng / 1 năm) theo API đồng bộ, có quản lý hàng đợi, ghi log Google Sheets, đếm số lượng theo tài khoản, hỗ trợ headless, cache UI, và retry an toàn.

## Tính năng chính
- 2 API đồng bộ (trả kết quả khi hoàn tất):
  - 1 tháng: `/addmail1m-sync?email=`
  - 1 năm: `/addmail1y-sync?email=`
- Quản lý tài khoản từ Google Sheets, tự động tăng count/đổi tài khoản khi đạt limit
- Cache UI: lưu selector và toạ độ các nút để chạy nhanh và ổn định cả khi headless
- Retry mời tối đa N lần (mặc định 3) trước khi kết luận thất bại
- Chế độ headless linh hoạt: qua GoLogin (cách 2) hoặc headless thuần (cách 1)
- Env-based routing, API key optional

---

## Yêu cầu hệ thống
- Node.js 18+ (khuyến nghị)
- Chrome/Chromium có sẵn (Puppeteer sẽ dùng executablePath từ GoLogin hoặc tìm chrome path)
- Tài khoản GoLogin (tuỳ chọn nếu dùng profile)
- Google Sheets service account (credentials JSON)
- (Tuỳ chọn) Tesseract OCR nếu bạn bật OCR fallback trong non-headless

Windows (khuyến nghị Tesseract nếu dùng OCR):
- Chocolatey: `choco install tesseract`
- Hoặc tải bộ cài Tesseract và thêm vào PATH

> Lưu ý: Ở chế độ headless + cache UI, OCR thường không cần thiết.

---

## Cài đặt nhanh

```bash
# 1) Clone repo
git clone https://github.com/nthanhtinh2402/canva_automation.git
cd canva_automation/canva-automation

# 2) Cài dependencies
npm ci
# hoặc: npm install

# 3) Chuẩn bị Google Sheets credentials
#   - Đặt file google-credentials.json vào thư mục canva-automation/
#   - Chia sẻ Google Sheet cho service account email trong file credentials

# 4) Tạo/sửa file .env (xem mẫu bên dưới)

# 5) Chạy server (auto reload khi sửa code)
npm run dev
# hoặc chạy thường (không auto reload)
npm start
```

---

## Cấu hình .env
Các biến phổ biến (đã có sẵn trong `.env` của dự án này — chỉnh lại cho phù hợp môi trường của bạn):

```dotenv
# Server
PORT=3000

# Puppeteer / GoLogin
HEADLESS=true                 # true để chạy ẩn; false để hiển thị
HEADLESS_FORCE_PURE=false     # true để bỏ GoLogin, dùng Puppeteer headless thuần
GOLOGIN_TOKEN=...             # token GoLogin (nếu dùng)
GOLOGIN_PROFILE_ID=...        # profile id (nếu dùng)
GOLOGIN_EXTRA_PARAMS=--no-first-run --no-default-browser-check --disable-notifications

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_SHEET_ID=...
ACCOUNTS_SHEET_GID=1996584998

# 2Captcha (nếu cần vượt captcha)
TWOCAPTCHA_API_KEY=...

# API routes + bật/tắt
API_ROUTE_1M=/addmail1m-sync
API_ROUTE_1Y=/addmail1y-sync
API_ENABLE_1M=true
API_ENABLE_1Y=true
API_KEY=                      # (tuỳ chọn) yêu cầu X-API-Key/Bearer/?api_key=

# Queue retry (0 = tắt retry ở queue)
QUEUE_MAX_RETRIES=0

# Tối ưu tốc độ (có thể tinh chỉnh)
INVITE_MAX_ATTEMPTS=3
NAV_WAIT=domcontentloaded
DELAY_SHORT=200
DELAY_MEDIUM=400
DELAY_LONG=800
BACKOFF_BASE_MS=400
INVITE_BACKOFF_STEP_MS=300
```

> Cảnh báo: `.env` thường chứa thông tin nhạy cảm (token, private key). Không nên commit `.env` công khai. Nếu bạn vẫn muốn commit, cân nhắc dùng giá trị dummy hoặc hạn chế quyền.

---

## Cài các gói cần thiết
Các gói đã nằm trong `package.json`. Chỉ cần:

```bash
# cài dependencies theo lockfile
npm ci
# hoặc
npm install
```

Dev server tự reload khi sửa code (nodemon đã cài sẵn trong devDependencies):
```bash
npm run dev
```

Chạy bình thường:
```bash
npm start
```

---

## Hướng dẫn sử dụng API

- Thêm email 1 tháng (đồng bộ):
```
GET http://localhost:3000/addmail1m-sync?email=user@gmail.com
Headers (nếu bật API_KEY): X-API-Key: <key>
```

- Thêm email 1 năm (đồng bộ):
```
GET http://localhost:3000/addmail1y-sync?email=user@gmail.com
Headers (nếu bật API_KEY): X-API-Key: <key>
```

Phản hồi mẫu (thành công):
```json
{
  "success": true,
  "message": "Đã mời thành công user@gmail.com",
  "taskId": 1723456789,
  "details": {
    "email": "user@gmail.com",
    "duration": "1 tháng",
    "loggedToSheets": true,
    "accountUsed": "<account>",
    "completedAt": "2025-08-12T12:34:56.000Z",
    "processingTime": "33s"
  }
}
```

Phản hồi mẫu (thất bại sau khi retry đủ lần):
```json
{
  "success": false,
  "message": "Mời user@gmail.com không thành công. Vui lòng thử lại sau. (Gợi ý: kiểm tra email có thể đã được mời trước đó hoặc xảy ra lỗi tạm thời từ Canva)",
  "rawError": "Canva đã xảy ra lỗi và không thể gửi thư mời. Vui lòng thử lại sau.",
  "taskId": 1723456789,
  "details": {
    "email": "user@gmail.com",
    "duration": "1 tháng",
    "loggedToSheets": false,
    "accountUsed": "unknown",
    "completedAt": "2025-08-12T12:34:56.000Z",
    "processingTime": "26s"
  }
}
```

---

## Ghi chú về headless và cache UI
- Hệ thống lưu cache cho các nút chính: mời thành viên, tab "mời qua email", nút gửi lời mời
- Khi đã có cache, lần sau click nhanh bằng selector/toạ độ đã lưu → rất phù hợp headless
- Nếu UI thay đổi làm cache sai, có thể xóa cache (xoá file `user-data/ui-cache.json`) hoặc dùng hàm clear cache

---

## Khắc phục sự cố
- Không ẩn được khi dùng GoLogin: một số profile GoLogin điều khiển hiển thị. Dùng `HEADLESS=true` + `GOLOGIN_EXTRA_PARAMS="--headless=new ..."`. Nếu không được, đặt `HEADLESS_FORCE_PURE=true` để dùng headless thuần.
- Không tìm thấy nút mời: lần đầu có thể chậm; hệ thống sẽ tìm bằng nhiều cách và lưu cache. Kiểm tra log để xem phương pháp nào được dùng.
- Lỗi Google Sheets: xác nhận `GOOGLE_SHEET_ID`, `ACCOUNTS_SHEET_GID`, và service account được chia sẻ.
- Hết tài khoản On: API sẽ trả lỗi ngay. Bật thêm tài khoản hoặc tăng limit.

---

## Scripts hữu ích
- `npm run dev`: chạy với tự reload
- `npm start`: chạy thường

---

## Cảnh báo bảo mật
- Hạn chế commit `.env` (token, private key). Khuyến nghị dùng `.env` cục bộ và `.env.sample` công khai.

Nếu bạn vẫn muốn upload `.env`, hãy xác nhận lại để mình bỏ `.env` khỏi `.gitignore` và commit theo yêu cầu.



---

## Tùy chỉnh thông điệp (message) động qua Google Sheets (GID/cột) hoặc .env

Ứng dụng cho phép bạn thay đổi thông điệp thành công/thất bại mà không cần sửa code.

- Placeholders hỗ trợ:
  - `{email}`: địa chỉ email được mời
  - `{reason}`: lý do kỹ thuật cuối cùng (nếu có) khi thất bại

Có 2 cách cấu hình (ưu tiên theo thứ tự):

1) Đọc trực tiếp theo cột từ một tab (sheet) có GID chỉ định
- Thêm 2 cột trong tab đó (header cột chuẩn xác):
  - `SUCCESS_MSG_TEMPLATE`
  - `FAIL_MSG_TEMPLATE`
- Ở hàng dữ liệu bạn chọn (theo chỉ số ), điền giá trị thông điệp, ví dụ:
  - SUCCESS_MSG_TEMPLATE = `Đã mời thành công {email}`
  - FAIL_MSG_TEMPLATE = `Mời {email} không thành công. Lý do: {reason}`
- Cấu hình .env:

```dotenv
CONFIG_SHEET_GID=<<GID_tab_ban_muon_doc>>
SUCCESS_MSG_TEMPLATE_COL=SUCCESS_MSG_TEMPLATE
FAIL_MSG_TEMPLATE_COL=FAIL_MSG_TEMPLATE
CONFIG_ROW_INDEX=1            # hàng dữ liệu cần đọc (1-based)
CONFIG_CACHE_TTL_MS=60000     # cache trong memory
CONFIG_REFRESH_MS=300000      # tự refresh mỗi 5 phút
```

2) Fallback: Đọc từ sheet "Config" kiểu Key/Value (nếu bạn muốn gom cấu hình vào 1 tab)
- Tạo tab tên `Config` (hoặc đặt ENV `CONFIG_SHEET_TITLE=...`)
- Tạo 2 cột: `Key` | `Value`
- Thêm các dòng:
  - Key: `SUCCESS_MSG_TEMPLATE` | Value: `Đã mời thành công {email}`
  - Key: `FAIL_MSG_TEMPLATE` | Value: `Mời {email} không thành công. Lý do: {reason}`

3) Fallback cuối: Đọc từ .env

```dotenv
SUCCESS_MSG_TEMPLATE="Đã mời thành công {email}"
FAIL_MSG_TEMPLATE="Mời {email} không thành công. Vui lòng thử lại sau. (Gợi ý: kiểm tra email có thể đã được mời trước đó hoặc xảy ra lỗi tạm thời từ Canva)"
```

Ghi chú
- Ứng dụng load cấu hình lúc khởi động và tự refresh định kỳ theo `CONFIG_REFRESH_MS`.
- Muốn áp dụng ngay: restart app, hoặc giảm tạm `CONFIG_REFRESH_MS` để test nhanh.

---

## Tối ưu khi GoLogin hết quota (fallback Puppeteer)
- Nếu GoLogin hết quota hoặc không dùng:
  - Đặt `HEADLESS_FORCE_PURE=true` để bỏ hẳn GoLogin, chạy Puppeteer trực tiếp (có/không headless tuỳ `HEADLESS`).
- Nếu vẫn muốn dùng GoLogin headless:
  - Kết hợp `HEADLESS=true` + `GOLOGIN_EXTRA_PARAMS="--headless=new --disable-gpu --disable-dev-shm-usage"`
- Hệ thống có fallback human-like (click/type/scroll/navigate) cho Puppeteer khi GoLogin không khởi tạo được.
