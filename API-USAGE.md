# Canva Automation API — Hướng dẫn sử dụng tối giản

Mục tiêu: chỉ dùng 2 API đồng bộ, trả kết quả chính xác sau khi chạy xong toàn bộ quá trình.
- 1m: thêm thành viên gói 1 tháng
- 1y: thêm thành viên gói 1 năm

Cả hai API chỉ trả JSON khi thao tác hoàn tất (thành công hoặc thất bại). Không dùng stream.

---

## 1) Chuẩn bị

Tạo file .env (đã có sẵn) với các biến sau:

```env
PORT=3000
GOOGLE_SHEET_ID=<ID Google Sheet của bạn>
ACCOUNTS_SHEET_GID=<GID của sheet Accounts>

# Quản lý route và bật/tắt API bằng .env
API_ROUTE_1M=/addmail1m-sync
API_ROUTE_1Y=/addmail1y-sync
API_ENABLE_1M=true   # false để tắt
API_ENABLE_1Y=true   # false để tắt
API_KEY=optional-secret-key  # (tuỳ chọn) yêu cầu X-API-Key, Bearer hoặc ?api_key=
```

Đặt file google-credentials.json vào thư mục canva-automation/ (đã có hướng dẫn chi tiết trong SETUP-GOOGLE-SHEETS.md).

Cấu trúc sheet Accounts cần có các cột: ID, Account, Current Count, Max Limit, Status, Last Used, Email, Date Added, Duration.

---

## 2) Khởi chạy

```bash
cd canva-automation
npm start
# hoặc
node app.js
```

Console sẽ hiển thị: “Server đang lắng nghe tại http://localhost:3000” và bắt đầu khởi tạo trình duyệt.

---

## 3) API đồng bộ (trả kết quả cuối cùng)

### 3.1. Thêm email 1 tháng

Request:
```
GET http://localhost:3000/addmail1m-sync?email=user@gmail.com
```

Response (thành công):
```json
{
  "success": true,
  "message": "Đã mời thành công user@gmail.com",
  "taskId": 1723456789,
  "details": {
    "email": "user@gmail.com",
    "duration": "1 tháng",
    "loggedToSheets": true,
    "accountUsed": "<account dùng>",
    "completedAt": "2025-08-12T12:34:56.000Z",
    "processingTime": "33s"
  }
}
```

Response (hết tài khoản khả dụng):
```json
{
  "success": false,
  "message": "Không còn tài khoản On khả dụng để mời. Vui lòng bổ sung tài khoản hoặc chờ tài khoản reset.",
  "details": {
    "email": "user@gmail.com",
    "duration": "1 tháng",
    "error": "Không có tài khoản On nào khả dụng",
    "failedAt": "2025-08-12T12:34:56.000Z"
  }
}
```

### 3.2. Thêm email 1 năm

Request:
```
GET http://localhost:3000/addmail1y-sync?email=user@gmail.com
```

Response: giống cấu trúc 1m, chỉ khác "duration": "1 năm".

---

## 4) Quy tắc hoạt động

- Hệ thống đọc trạng thái account trực tiếp từ Google Sheets, chỉ dùng tài khoản Status=On và Current Count < Max Limit.
- Khi mời thành công: ghi log email vào dòng mới, tăng Current Count, tự động chuyển Status=Off nếu đạt limit, sau đó chọn ID kế tiếp đúng tuần tự.
- Nếu hết tài khoản khả dụng: trả lỗi ngay, không retry vòng lặp vô hạn.

---

## 5) Kiểm tra nhanh

- Trạng thái hàng đợi (tham khảo):
```
GET http://localhost:3000/queue-status
```
- Thống kê account hiện tại:
```
GET http://localhost:3000/account-stats
```

---

## 6) Gỡ lỗi thường gặp

- 503 ngay khi gọi API: Hết tài khoản On khả dụng. Bật lại Status=On hoặc tăng Max Limit/giảm Current Count.
- Lỗi xác thực Google Sheets: Kiểm tra GOOGLE_SHEET_ID, ACCOUNTS_SHEET_GID và quyền chia sẻ cho service account.
- Bị treo ở đăng nhập Canva: kiểm tra mạng, captcha/bot detection; xem log server để biết bước lỗi.

---

## 7) Ghi chú

- Không cần endpoint stream; chỉ dùng 2 endpoint đồng bộ:
  - /addmail1m-sync
  - /addmail1y-sync
- Các endpoint async (/addmail1m, /addmail1y) có thể vẫn tồn tại cho mục đích enqueue, nhưng khi chạy production khuyến nghị dùng bản sync để nhận kết quả cuối cùng ngay.

