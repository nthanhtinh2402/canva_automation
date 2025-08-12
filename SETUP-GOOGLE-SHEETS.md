# � CANVA AUTOMATION - HƯỚNG DẪN SETUP GOOGLE SHEETS

## 🎯 **TỔNG QUAN HỆ THỐNG**

Hệ thống Canva Automation sử dụng Google Sheets để:
- **Quản lý tài khoản**: Theo dõi 10 ID tài khoản với limit riêng biệt
- **Đếm số lượng**: Tự động tăng count khi mời thành công
- **Chuyển tài khoản**: Tự động Off khi đạt limit và chuyển sang ID khác
- **Log email**: Ghi lại từng email đã mời vào dòng riêng biệt
- **Logout session**: Tự động logout và clear cache khi chuyển tài khoản

---

## 🔧 **BƯỚC 1: TẠO GOOGLE SHEETS**

### **1.1. Tạo Sheet mới:**
1. Vào [Google Sheets](https://sheets.google.com)
2. Tạo sheet mới
3. Đặt tên: **"TÀI KHOẢN CANVA AUTOMATION"**

### **1.2. Tạo cấu trúc bảng:**

| ID | Account | Current Count | Max Limit | Status | Last Used | Email | Date Added | Duration |
|----|---------|---------------|-----------|--------|-----------|-------|------------|----------|
| 1  | phamanhha.edu@hotmail.com \| password123 | 0 | 3 | On | | | | |
| 2  | phamanhha.edu@hotmail.com \| password123 | 0 | 2 | On | | | | |
| 3  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 4  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 5  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 6  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 7  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 8  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 9  | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |
| 10 | phamanhha.edu@hotmail.com \| password123 | 0 | 4 | On | | | | |

### **1.3. Giải thích các cột:**
- **ID**: Số thứ tự tài khoản (1-10)
- **Account**: Email và password (format: email | password)
- **Current Count**: Số email đã mời hiện tại
- **Max Limit**: Giới hạn tối đa cho mỗi ID
- **Status**: On/Off (tự động Off khi đạt limit)
- **Last Used**: Thời gian sử dụng cuối
- **Email**: Email được mời (log từng dòng riêng)
- **Date Added**: Ngày thêm email
- **Duration**: Thời hạn mời (1m/1y)

---

## 🔑 **BƯỚC 2: LẤY GOOGLE SHEETS ID**

### **2.1. Copy URL của Google Sheets:**
```
https://docs.google.com/spreadsheets/d/1ABC123DEF456GHI789JKL/edit#gid=0
```

### **2.2. Lấy Sheet ID:**
```
Sheet ID: 1ABC123DEF456GHI789JKL
```

### **2.3. Cập nhật file `.env`:**
```env
GOOGLE_SHEET_ID=1ABC123DEF456GHI789JKL
```

---

## 🔐 **BƯỚC 3: TẠO GOOGLE SERVICE ACCOUNT**

### **3.1. Vào Google Cloud Console:**
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project có sẵn

### **3.2. Enable Google Sheets API:**
1. Vào **"APIs & Services"** → **"Library"**
2. Tìm **"Google Sheets API"**
3. Click **"Enable"**

### **3.3. Tạo Service Account:**
1. Vào **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"Service Account"**
3. Đặt tên: **"canva-automation-service"**
4. Click **"Create and Continue"**
5. Role: **"Editor"**
6. Click **"Done"**

### **3.4. Tạo Key:**
1. Click vào Service Account vừa tạo
2. Vào tab **"Keys"**
3. Click **"Add Key"** → **"Create new key"**
4. Chọn **"JSON"**
5. Download file JSON

### **3.5. Đặt tên file:**
```
google-credentials.json
```

### **3.6. Copy vào thư mục project:**
```
canva-automation/
├── google-credentials.json  ← File này
├── account-manager.js
├── app.js
└── ...
```

---

## � **BƯỚC 4: CHIA SẺ GOOGLE SHEETS**

### **4.1. Lấy email Service Account:**
Mở file `google-credentials.json`, tìm:
```json
{
  "client_email": "canva-automation-service@project-name.iam.gserviceaccount.com"
}
```

### **4.2. Chia sẻ Google Sheets:**
1. Mở Google Sheets
2. Click nút **"Share"** (góc trên bên phải)
3. Thêm email Service Account
4. Cấp quyền: **"Editor"**
5. Click **"Send"**

---

## 🧪 **BƯỚC 5: TEST HỆ THỐNG**

### **5.1. Khởi động server:**
```bash
cd canva-automation
npm start
```

### **5.2. Test API endpoints (đồng bộ):**

#### **Thêm email 1 tháng (sync):**
```bash
GET http://localhost:3000/addmail1m-sync?email=test1@gmail.com
```

#### **Thêm email 1 năm (sync):**
```bash
GET http://localhost:3000/addmail1y-sync?email=test2@gmail.com
```

#### **Test queue system:**
```bash
POST http://localhost:3000/queue
Content-Type: application/json

{
  "email": "test3@gmail.com",
  "duration": "1m"
}
```

#### **Test account status:**
```bash
GET http://localhost:3000/account-stats
```

### **5.3. Kiểm tra kết quả:**
1. Mở Google Sheets
2. Kiểm tra:
   - **Current Count** đã tăng
   - **Status** tự động Off khi đạt limit
   - **Email log** xuất hiện ở dòng mới
   - **Last Used** được cập nhật

---

## 🎯 **LOGIC HOẠT ĐỘNG**

### **6.1. Quy trình tự động:**
```
1. Chọn tài khoản On có capacity
2. Mời email qua Canva
3. Nếu thành công:
   - Log email vào dòng mới
   - Tăng Current Count
   - Nếu đạt limit → Status = Off
   - Chuyển sang ID tiếp theo
4. Nếu thất bại:
   - Return false ngay
   - Không tăng count
   - Không retry
```

### **6.2. Session Management:**
```
- Khi chuyển tài khoản → Logout và clear cache
- Khi tài khoản không Active → Logout ngay
- Error từ Canva → Return false, không retry
```

---

## 🚨 **LƯU Ý QUAN TRỌNG**

### **7.1. Bảo mật:**
- **KHÔNG** commit file `google-credentials.json` lên Git
- **KHÔNG** chia sẻ Service Account email
- **LUÔN** giữ file `.env` an toàn

### **7.2. Monitoring:**
- Kiểm tra Google Sheets thường xuyên
- Theo dõi Current Count và Status
- Xem log email để đảm bảo hoạt động đúng

### **7.3. Troubleshooting:**
```bash
# Kiểm tra connection
GET http://localhost:3000/account-stats

# Reset tất cả count về 0
# (Chỉnh sửa trực tiếp trong Google Sheets)

# Bật lại tất cả tài khoản
# (Đổi Status từ Off → On trong Google Sheets)
```

---

## ✅ **CHECKLIST HOÀN THÀNH**

- [ ] Tạo Google Sheets với đúng cấu trúc
- [ ] Lấy được Sheet ID và cập nhật `.env`
- [ ] Tạo Service Account và enable API
- [ ] Download file `google-credentials.json`
- [ ] Chia sẻ Sheet với Service Account
- [ ] Test API thành công
- [ ] Kiểm tra logic tự động hoạt động
- [ ] Verify session management
- [ ] Confirm error handling

**🎉 Khi hoàn thành checklist → Hệ thống sẵn sàng production!**

---

## 📁 **CẤU TRÚC FILES CUỐI CÙNG:**

```
canva-automation/
├── google-credentials.json    ← File JSON từ Google Cloud
├── .env                      ← Chứa GOOGLE_SHEET_ID
├── account-manager.js        ← Quản lý tài khoản và logic core
├── app.js                    ← Main application với error detection
├── gologin-browser.js        ← Browser management với logout
├── queue-manager.js          ← Quản lý hàng đợi
├── sheets-manager.js         ← Quản lý Google Sheets
└── SETUP-GOOGLE-SHEETS.md    ← File hướng dẫn này
```

## 🎯 **API ENDPOINTS HOÀN CHỈNH:**

### **Production APIs:**
```bash
# Thêm email vào queue
POST http://localhost:3000/queue
Content-Type: application/json
{
  "email": "user@gmail.com",
  "duration": "1m"
}

# Kiểm tra trạng thái queue
GET http://localhost:3000/queue-status

# Kiểm tra trạng thái accounts
GET http://localhost:3000/account-stats

# Kiểm tra thống kê Google Sheets
GET http://localhost:3000/sheets-stats
```

### **Test APIs:**
```bash
# Test nhanh 1 tháng
GET http://localhost:3000/addmail1m?email=test@gmail.com
# => 503 nếu hết tài khoản khả dụng

# Test nhanh 1 năm
GET http://localhost:3000/addmail1y?email=test@gmail.com
```

**🚀 Hệ thống đã sẵn sàng cho production với logic hoàn hảo!**
