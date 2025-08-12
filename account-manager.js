const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

class AccountManager {
    constructor() {
        this.doc = null;
        this.serviceAccountAuth = null;
        this.sheetId = process.env.GOOGLE_SHEET_ID;
        this.accountsSheetGid = parseInt(process.env.ACCOUNTS_SHEET_GID) || 1996584998;
        this.credentialsPath = path.join(__dirname, 'google-credentials.json');
        this.currentAccount = null;
        this.currentAccountIndex = 0;
        this.accounts = [];
    }

    // Khởi tạo kết nối
    async initialize() {
        try {
            console.log('🔗 Đang khởi tạo Account Manager...');
            
            // Kiểm tra credentials file
            if (!fs.existsSync(this.credentialsPath)) {
                throw new Error('Không tìm thấy file google-credentials.json');
            }

            // Đọc credentials
            const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
            
            // Tạo JWT auth
            this.serviceAccountAuth = new JWT({
                email: credentials.client_email,
                key: credentials.private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            // Khởi tạo document
            this.doc = new GoogleSpreadsheet(this.sheetId, this.serviceAccountAuth);
            await this.doc.loadInfo();
            
            console.log(`✓ Đã kết nối Google Sheet: ${this.doc.title}`);
            
            // Tìm hoặc tạo sheet "Accounts"
            await this.setupAccountsSheet();
            
            // Load danh sách accounts
            await this.loadAccounts();
            
            return true;
            
        } catch (error) {
            console.error('❌ Lỗi khởi tạo Account Manager:', error.message);
            return false;
        }
    }

    // Setup sheet bằng GID
    async setupAccountsSheet() {
        try {
            // Tìm sheet bằng GID
            let accountsSheet = this.doc.sheetsById[this.accountsSheetGid];

            if (!accountsSheet) {
                console.log(`❌ Không tìm thấy sheet với GID: ${this.accountsSheetGid}`);
                console.log('💡 Vui lòng kiểm tra ACCOUNTS_SHEET_GID trong file .env');
                throw new Error(`Sheet với GID ${this.accountsSheetGid} không tồn tại`);
            }

            console.log(`✓ Tìm thấy sheet: "${accountsSheet.title}" (GID: ${this.accountsSheetGid})`);

            // Kiểm tra headers
            await accountsSheet.loadHeaderRow();
            const headers = accountsSheet.headerValues;
            console.log('📋 Headers hiện tại:', headers);

            // Kiểm tra xem có đủ cột cần thiết không
            const requiredHeaders = ['ID', 'Account', 'Current Count', 'Max Limit', 'Status', 'Last Used', 'Email', 'Date Added', 'Duration'];
            const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));

            if (missingHeaders.length > 0) {
                console.log(`⚠️ Thiếu các cột: ${missingHeaders.join(', ')}`);
                console.log('💡 Vui lòng thêm các cột này vào sheet');
            }

            console.log('✓ Sheet accounts đã sẵn sàng');

        } catch (error) {
            console.error('❌ Lỗi setup accounts sheet:', error.message);
            throw error;
        }
    }

    // Load danh sách accounts từ Google Sheet bằng GID
    async loadAccounts() {
        try {
            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
            if (!accountsSheet) {
                throw new Error(`Sheet với GID ${this.accountsSheetGid} không tồn tại`);
            }

            const rows = await accountsSheet.getRows();
            this.accounts = [];

            for (const row of rows) {
                const id = row.get('ID') || row.rowIndex; // Sử dụng ID từ sheet hoặc rowIndex
                const account = row.get('Account');
                const currentCount = parseInt(row.get('Current Count')) || 0;
                const maxLimit = parseInt(row.get('Max Limit')) || 100;
                // Normalize Status from sheet (trim + case-insensitive)
                let statusRaw = row.get('Status');
                let status = (statusRaw === undefined || statusRaw === null || statusRaw === '') ? 'On' : statusRaw.toString().trim();
                const statusLower = status.toLowerCase();
                if (statusLower === 'active' || statusLower === 'on') status = 'On';
                else if (statusLower === 'off') status = 'Off';
                const lastUsed = row.get('Last Used') || '';

                if (account && account.includes('|')) {
                    const [username, password] = account.split('|');

                    this.accounts.push({
                        id,
                        username: username.trim(),
                        password: password.trim(),
                        currentCount,
                        maxLimit,
                        status,
                        lastUsed,
                        rowIndex: row.rowIndex
                    });
                }
            }

            console.log(`✓ Đã load ${this.accounts.length} tài khoản`);

            // Debug: Hiển thị chi tiết từng account
            console.log('📋 Chi tiết accounts:');
            this.accounts.forEach((acc, index) => {
                console.log(`  ID: ${acc.id} | ${acc.username} - Count: ${acc.currentCount}/${acc.maxLimit} - Status: ${acc.status}`);
            });

            // CRITICAL FIX: Khởi tạo với vị trí đã lưu
            await this.initializeWithSavedPosition();
            
        } catch (error) {
            console.error('❌ Lỗi load accounts:', error.message);
            throw error;
        }
    }

    // Chọn tài khoản tiếp theo có thể sử dụng
    async selectNextAvailableAccount() {
        try {
            console.log('🔍 Đang tìm tài khoản khả dụng...');

            // Debug: Hiển thị tất cả accounts trước khi filter
            console.log('📋 Tất cả accounts hiện tại:');
            this.accounts.forEach((acc, index) => {
                const available = acc.status === 'On' && acc.currentCount < acc.maxLimit;
                console.log(`  ID: ${acc.id} | ${acc.username} - ${acc.currentCount}/${acc.maxLimit} - ${acc.status} - ${available ? '✅ Khả dụng' : '❌ Không khả dụng'}`);
            });

            // Tìm tài khoản On và chưa đạt limit (chỉ tài khoản có Status = 'On')
            const availableAccounts = this.accounts.filter(acc => {
                const isOn = acc.status === 'On';
                const hasCapacity = acc.currentCount < acc.maxLimit;
                const isAvailable = isOn && hasCapacity;

                console.log(`  🔍 Kiểm tra ${acc.username}: On=${isOn}, HasCapacity=${hasCapacity}, Available=${isAvailable}`);
                return isAvailable;
            });

            console.log(`🎯 Tìm thấy ${availableAccounts.length} tài khoản khả dụng`);

            if (availableAccounts.length === 0) {
                console.log('⚠️ Không có tài khoản On nào khả dụng!');
                console.log('🔄 Tất cả tài khoản đã đạt limit hoặc bị Inactive');

                // Debug: Hiển thị lý do tại sao không có tài khoản khả dụng
                console.log('📊 Phân tích chi tiết:');
                const activeAccounts = this.accounts.filter(acc => acc.status === 'On');
                const inactiveAccounts = this.accounts.filter(acc => acc.status !== 'On');
                const limitReachedAccounts = this.accounts.filter(acc => acc.currentCount >= acc.maxLimit);

                console.log(`  - Tổng tài khoản: ${this.accounts.length}`);
                console.log(`  - Tài khoản On: ${activeAccounts.length}`);
                console.log(`  - Tài khoản Off: ${inactiveAccounts.length}`);
                console.log(`  - Tài khoản đã đạt limit: ${limitReachedAccounts.length}`);

                // Ném lỗi rõ ràng để tầng trên biết và không retry queue
                throw new Error('Không có tài khoản On nào khả dụng');
            }

            // CRITICAL FIX: Chọn tài khoản tuần tự ĐÚNG (1→2→3→4→5→6→7→8→9→10→1)
            const previousAccountInfo = this.currentAccount ? `ID ${this.currentAccount.id}` : 'none';
            let selectedAccount = null;

            // Sắp xếp theo ID để đảm bảo thứ tự tuần tự
            availableAccounts.sort((a, b) => a.id - b.id);

            console.log(`🔍 Available accounts sorted by ID:`, availableAccounts.map(acc => `ID ${acc.id} (${acc.currentCount}/${acc.maxLimit})`));

            // CRITICAL FIX: Chọn ID tiếp theo tuần tự (bao gồm cả ID Off)
            if (this.currentAccount) {
                console.log(`🔍 Current account: ID ${this.currentAccount.id}, looking for NEXT sequential ID...`);

                // CRITICAL FIX: Chọn ID tiếp theo tuần tự ĐÚNG (1→2→3→4→5→6→7→8→9→10→1)
                const currentId = parseInt(this.currentAccount.id); // Convert to number
                console.log(`🔍 Current ID: ${currentId}, finding next sequential ID...`);

                // Tìm ID tiếp theo tuần tự (currentId + 1)
                let nextId = currentId + 1;

                // Tìm ID tiếp theo có Status On và có capacity
                let attempts = 0;
                const maxAttempts = 10; // Tối đa 10 ID

                while (attempts < maxAttempts) {
                    // Wrap around nếu vượt quá ID 10
                    if (nextId > 10) {
                        nextId = 1;
                        console.log(`🔄 Wrapping from ID 10 to ID 1`);
                    }

                    // CRITICAL FIX: Convert to number để so sánh đúng
                    const candidateAccount = this.accounts.find(acc => parseInt(acc.id) === nextId);
                    console.log(`🔍 Checking sequential ID ${nextId}: ${candidateAccount ? `Status=${candidateAccount.status}, Count=${candidateAccount.currentCount}/${candidateAccount.maxLimit}` : 'Not found'}`);

                    if (candidateAccount && candidateAccount.status === 'On' && candidateAccount.currentCount < candidateAccount.maxLimit) {
                        selectedAccount = candidateAccount;
                        console.log(`✅ Found next sequential available ID: ${nextId} (${candidateAccount.currentCount}/${candidateAccount.maxLimit})`);
                        break;
                    }

                    // Chuyển sang ID tiếp theo
                    nextId++;
                    attempts++;

                    // Tránh infinite loop - check nếu đã quay lại ID ban đầu
                    if (nextId > 10) {
                        nextId = 1; // Reset về 1 khi vượt 10
                    }

                    if (attempts > 0 && nextId === (currentId + 1 > 10 ? 1 : currentId + 1)) {
                        console.log(`🔄 Completed full cycle, no other available account`);
                        break;
                    }
                }

                if (!selectedAccount) {
                    console.log(`❌ No available account found in sequential order after ${attempts} attempts`);
                    return false;
                }
            } else {
                // Chọn ID 1 đầu tiên
                selectedAccount = availableAccounts.find(acc => acc.id === 1) || availableAccounts[0];
                console.log(`✅ No current account, selecting ID 1 or first available: ID ${selectedAccount.id}`);
            }

            this.currentAccount = selectedAccount;
            this.currentAccountIndex = this.accounts.findIndex(acc => acc === this.currentAccount);

            // CRITICAL FIX: Lưu vị trí ID để lần sau sử dụng
            await this.saveCurrentAccountPosition();

            console.log(`✓ Đã chuyển từ tài khoản: ${previousAccountInfo} → ID ${this.currentAccount.id}`);
            console.log(`📊 Tài khoản mới: ID ${this.currentAccount.id} (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit}) - Status: ${this.currentAccount.status}`);

            return true; // Thành công

        } catch (error) {
            console.error('❌ Lỗi chọn tài khoản:', error.message);
            throw error;
        }
    }

    // Lấy thông tin tài khoản hiện tại
    getCurrentAccount() {
        // Kiểm tra xem tài khoản hiện tại có còn On không
        if (this.currentAccount && this.currentAccount.status !== 'On') {
            console.log(`⚠️ Tài khoản hiện tại ${this.currentAccount.username} không còn On (Status: ${this.currentAccount.status})`);
            return null;
        }

        // Kiểm tra xem tài khoản hiện tại có đã đạt limit không
        if (this.currentAccount && this.currentAccount.currentCount >= this.currentAccount.maxLimit) {
            console.log(`⚠️ Tài khoản hiện tại ${this.currentAccount.username} đã đạt limit (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit})`);
            return null;
        }

        return this.currentAccount;
    }

    // Reload thông tin tài khoản hiện tại từ Google Sheet
    async reloadCurrentAccount() {
        try {
            if (!this.currentAccount) {
                return false;
            }

            console.log(`🔄 Reload thông tin tài khoản: ${this.currentAccount.username}`);

            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
            const rows = await accountsSheet.getRows();

            const targetRow = rows.find(row => {
                const rowId = row.get('ID');
                return rowId && rowId.toString() === this.currentAccount.id.toString();
            });

            if (targetRow) {
                // Cập nhật thông tin từ sheet
                const currentCount = parseInt(targetRow.get('Current Count')) || 0;
                const maxLimit = parseInt(targetRow.get('Max Limit')) || 100;
                // Normalize Status (trim + case-insensitive)
                let statusRaw = targetRow.get('Status');
                let status = (statusRaw === undefined || statusRaw === null || statusRaw === '') ? 'On' : statusRaw.toString().trim();
                const statusLower = status.toLowerCase();
                if (statusLower === 'active' || statusLower === 'on') status = 'On';
                else if (statusLower === 'off') status = 'Off';
                const lastUsed = targetRow.get('Last Used') || '';

                this.currentAccount.currentCount = currentCount;
                this.currentAccount.maxLimit = maxLimit;
                this.currentAccount.status = status;
                this.currentAccount.lastUsed = lastUsed;

                console.log(`✓ Đã reload: ${this.currentAccount.username} (${currentCount}/${maxLimit}) - Status: ${status}`);
                return true;
            } else {
                console.error(`❌ Không tìm thấy row để reload cho ${this.currentAccount.username}`);
                return false;
            }

        } catch (error) {
            console.error('❌ Lỗi reload tài khoản:', error.message);
            return false;
        }
    }

    // Reload tất cả accounts từ Google Sheet để lấy thông tin mới nhất
    async reloadAllAccountsFromSheet() {
        try {
            console.log('🔄 Reload tất cả accounts từ Google Sheet...');

            // Chờ một chút để Google Sheets API cập nhật cache
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Force reload sheet info để tránh cache
            await this.doc.loadInfo();

            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];

            // Force reload rows để tránh cache
            await accountsSheet.loadCells();
            const rows = await accountsSheet.getRows();

            // Cập nhật thông tin cho tất cả accounts - FIX: Tìm theo ID thay vì username
            for (let i = 0; i < this.accounts.length; i++) {
                const account = this.accounts[i];
                const targetRow = rows.find(row => {
                    const rowId = row.get('ID');
                    return rowId && rowId.toString() === account.id.toString();
                });

                if (targetRow) {
                    const currentCount = parseInt(targetRow.get('Current Count')) || 0;
                    const maxLimit = parseInt(targetRow.get('Max Limit')) || 100;
                    // Normalize Status (trim + case-insensitive)
                    let statusRaw = targetRow.get('Status');
                    let status = (statusRaw === undefined || statusRaw === null || statusRaw === '') ? 'On' : statusRaw.toString().trim();
                    const statusLower = status.toLowerCase();
                    if (statusLower === 'active' || statusLower === 'on') status = 'On';
                    else if (statusLower === 'off') status = 'Off';

                    // Log thông tin cập nhật
                    console.log(`🔄 Cập nhật ID ${account.id}: Count=${currentCount}, Status=${status}`);

                    // Cập nhật thông tin
                    this.accounts[i].currentCount = currentCount;
                    this.accounts[i].maxLimit = maxLimit;
                    this.accounts[i].status = status;
                    this.accounts[i].rowIndex = targetRow.rowIndex;
                } else {
                    console.log(`⚠️ Không tìm thấy row cho ID ${account.id}`);
                }
            }

            // Cập nhật currentAccount nếu có
            if (this.currentAccount) {
                const updatedAccount = this.accounts.find(acc => acc.id.toString() === this.currentAccount.id.toString());
                if (updatedAccount) {
                    this.currentAccount = updatedAccount;
                }
            }

            console.log('✓ Đã reload tất cả accounts từ Google Sheet');
            return true;

        } catch (error) {
            console.error('❌ Lỗi reload accounts:', error.message);
            return false;
        }
    }

    // Đảm bảo có tài khoản On khả dụng
    async ensureActiveAccount() {
        try {
            // Reload tất cả accounts từ sheet để lấy thông tin mới nhất
            await this.reloadAllAccountsFromSheet();

            const currentAccount = this.getCurrentAccount();

            // Kiểm tra tài khoản hiện tại có còn khả dụng không
            if (!currentAccount || currentAccount.status !== 'On' || currentAccount.currentCount >= currentAccount.maxLimit) {
                console.log('🔄 CRITICAL: Tài khoản hiện tại không khả dụng, cần chuyển tài khoản...');

                // Chọn tài khoản khác trước, CHỈ logout nếu thực sự có sự thay đổi tài khoản
                const prevAccount = this.currentAccount;
                const switched = await this.selectNextAvailableAccount();

                if (!switched) {
                    throw new Error('Không có tài khoản On nào khả dụng');
                }

                if (!prevAccount || parseInt(this.currentAccount.id) !== parseInt(prevAccount.id)) {
                    await this.logoutAndClearSession();
                    console.log(`✅ Đã logout tài khoản cũ trước khi dùng tài khoản mới`);
                } else {
                    console.log(`ℹ️ Vẫn giữ nguyên tài khoản hiện tại, không cần logout`);
                }

                console.log(`✓ Đã chuyển sang tài khoản On: ${this.currentAccount.username}`);
                return this.currentAccount;
            }

            return currentAccount;

        } catch (error) {
            console.error('❌ Lỗi đảm bảo tài khoản On:', error.message);
            throw error;
        }
    }

    // Tăng count sau khi add thành công
    async incrementSuccessCount() {
        try {
            if (!this.currentAccount) {
                throw new Error('Không có tài khoản hiện tại');
            }

            // Reload thông tin tài khoản từ sheet để lấy số count chính xác
            console.log(`🔄 Reload count từ Google Sheet trước khi tăng...`);

            // Lấy count hiện tại trực tiếp từ Google Sheet
            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
            const rows = await accountsSheet.getRows();

            const currentRow = rows.find(row => {
                const rowId = row.get('ID');
                return rowId && rowId.toString() === this.currentAccount.id.toString();
            });

            if (currentRow) {
                const currentCountFromSheet = parseInt(currentRow.get('Current Count')) || 0;
                const oldCount = this.currentAccount.currentCount;

                // Cập nhật count từ sheet
                this.currentAccount.currentCount = currentCountFromSheet;
                console.log(`📊 Count từ sheet: ${currentCountFromSheet}, Count trong memory: ${oldCount}`);

                if (currentCountFromSheet !== oldCount) {
                    console.log(`🔄 Đã cập nhật count từ ${oldCount} → ${currentCountFromSheet} (từ Google Sheet)`);
                }
            } else {
                console.error(`❌ Không tìm thấy tài khoản ${this.currentAccount.username} trong Google Sheet`);
                throw new Error(`Không tìm thấy tài khoản ${this.currentAccount.username} trong Google Sheet`);
            }

            // Kiểm tra lại trạng thái tài khoản hiện tại trước khi tăng count
            if (this.currentAccount.status !== 'On') {
                console.log(`⚠️ Tài khoản hiện tại ${this.currentAccount.username} không còn On, đang chuyển sang tài khoản khác...`);
                const switched = await this.selectNextAvailableAccount();
                if (!switched) {
                    throw new Error('Không có tài khoản On nào khả dụng');
                }
            }

            // Lưu thông tin tài khoản hiện tại để debug
            const currentAccountUsername = this.currentAccount.username;
            const oldCount = this.currentAccount.currentCount;

            // Tăng count
            this.currentAccount.currentCount++;

            // Tìm row để cập nhật count - FIX: Tìm theo ID thay vì username
            const targetRow = rows.find(row => {
                const rowId = row.get('ID');
                return rowId && rowId.toString() === this.currentAccount.id.toString();
            });

            if (targetRow) {
                targetRow.set('Current Count', this.currentAccount.currentCount);
                targetRow.set('Last Used', new Date().toLocaleString('vi-VN'));
                await targetRow.save();
                console.log(`✓ Đã cập nhật Google Sheet cho ${currentAccountUsername}: ${oldCount} → ${this.currentAccount.currentCount} (Row: ${this.currentAccount.rowIndex || 'N/A'})`);
            } else {
                console.error(`❌ Không tìm thấy row trong Google Sheet cho tài khoản ${currentAccountUsername} (Row: ${this.currentAccount.rowIndex || 'N/A'})`);

                // Debug: Hiển thị tất cả rows để kiểm tra
                console.log('🔍 Debug - Tất cả rows hiện tại:');
                rows.forEach(row => {
                    const rowAccount = row.get('Account');
                    const rowUsername = rowAccount && rowAccount.includes('|') ? rowAccount.split('|')[0].trim() : '';
                    console.log(`  Row ${row.rowIndex}: ${rowUsername} - Count: ${row.get('Current Count')} - Status: ${row.get('Status')}`);
                });
            }

            console.log(`✓ Tăng count: ${currentAccountUsername} (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit})`);

            // Kiểm tra xem đã đạt limit chưa
            if (this.currentAccount.currentCount >= this.currentAccount.maxLimit) {
                console.log(`🚫 Tài khoản ${currentAccountUsername} đã đạt limit (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit})`);

                // Chuyển Status từ "On" sang "Off"
                if (targetRow) {
                    targetRow.set('Status', 'Off');
                    await targetRow.save();
                    console.log(`✓ Đã chuyển Status của ${currentAccountUsername} sang "Off" (Row: ${this.currentAccount.rowIndex})`);

                    // Cập nhật status trong memory ngay lập tức
                    this.currentAccount.status = 'Off';
                } else {
                    console.error(`❌ Không thể cập nhật Status cho ${currentAccountUsername} (Row: ${this.currentAccount.rowIndex})`);

                    // Thử tìm và cập nhật bằng cách khác
                    const fallbackRow = rows.find(row => {
                        const rowAccount = row.get('Account');
                        const rowUsername = rowAccount && rowAccount.includes('|') ? rowAccount.split('|')[0].trim() : '';
                        const rowCount = parseInt(row.get('Current Count')) || 0;
                        return rowUsername === currentAccountUsername && rowCount === this.currentAccount.currentCount;
                    });

                    if (fallbackRow) {
                        fallbackRow.set('Status', 'Off');
                        await fallbackRow.save();
                        console.log(`✓ Đã cập nhật Status bằng fallback method cho ${currentAccountUsername} (Row: ${fallbackRow.rowIndex})`);
                        this.currentAccount.status = 'Off';
                    }
                }

                // Reload accounts để cập nhật trạng thái mới
                console.log(`🔄 Reload accounts để cập nhật trạng thái...`);
                await this.loadAccounts();

                // Chuyển sang tài khoản khác (chỉ tìm tài khoản On)
                console.log(`🔄 Đang chuyển sang tài khoản On khác...`);
                const switched = await this.selectNextAvailableAccount();

                if (!switched) {
                    console.log(`❌ Không còn tài khoản On nào khả dụng!`);
                    throw new Error('Tất cả tài khoản đã đạt limit hoặc không On');
                }

                // CRITICAL FIX: Logout và clear cache khi chuyển tài khoản
                console.log(`🔄 Logout và clear cache trước khi chuyển tài khoản...`);
                await this.logoutAndClearSession();

                // Yêu cầu logout và login lại
                console.log(`🔄 Cần đóng trình duyệt và khởi tạo lại với tài khoản: ${this.currentAccount.username}`);
                console.log(`📊 Tài khoản mới: ${this.currentAccount.username} (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit}) - Status: ${this.currentAccount.status}`);

                return { needRelogin: true, newAccount: this.currentAccount };
            }

            return true;

        } catch (error) {
            console.error('❌ Lỗi tăng success count:', error.message);
            return false;
        }
    }

    // Reset tất cả accounts về 0
    async resetAllAccounts() {
        try {
            console.log('🔄 Reset tất cả accounts về 0...');
            
            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
            const rows = await accountsSheet.getRows();

            for (const row of rows) {
                row.set('Current Count', 0);
                row.set('Status', 'On');
                await row.save();
            }

            // Reload accounts
            await this.loadAccounts();
            
            console.log('✓ Đã reset tất cả accounts');
            return true;

        } catch (error) {
            console.error('❌ Lỗi reset accounts:', error.message);
            return false;
        }
    }

    // Lấy thống kê accounts
    async getAccountStats() {
        try {
            const stats = {
                total: this.accounts.length,
                active: 0,
                limitReached: 0,
                totalInvites: 0,
                currentAccount: this.currentAccount ? {
                    username: this.currentAccount.username,
                    count: this.currentAccount.currentCount,
                    limit: this.currentAccount.maxLimit,
                    remaining: this.currentAccount.maxLimit - this.currentAccount.currentCount
                } : null
            };

            for (const account of this.accounts) {
                if (account.status === 'On' && account.currentCount < account.maxLimit) {
                    stats.active++;
                } else if (account.currentCount >= account.maxLimit) {
                    stats.limitReached++;
                }
                stats.totalInvites += account.currentCount;
            }

            return stats;

        } catch (error) {
            console.error('❌ Lỗi lấy account stats:', error.message);
            return null;
        }
    }

    // Thêm tài khoản mới
    async addAccount(username, password, maxLimit = 100) {
        try {
            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];

            await accountsSheet.addRow({
                'Account': `${username}|${password}`,
                'Current Count': 0,
                'Max Limit': maxLimit,
                'Status': 'On',
                'Last Used': ''
            });

            console.log(`✓ Đã thêm tài khoản: ${username}`);

            // Reload accounts
            await this.loadAccounts();

            return true;

        } catch (error) {
            console.error('❌ Lỗi thêm tài khoản:', error.message);
            return false;
        }
    }

    // CRITICAL FIX: Logout và clear session khi chuyển tài khoản
    async logoutAndClearSession() {
        try {
            console.log('🔄 Bắt đầu logout và clear session...');

            // Import browser functions
            const { getPage, clearSessionData } = require('./gologin-browser');
            const page = getPage();

            if (page) {
                // 1. Logout từ Canva
                console.log('🔄 Đang logout từ Canva...');
                try {
                    await page.goto('https://www.canva.com/logout', {
                        waitUntil: 'networkidle0',
                        timeout: 15000
                    });
                    console.log('✓ Đã logout từ Canva');
                } catch (error) {
                    console.log('⚠️ Lỗi logout, tiếp tục clear cache:', error.message);
                }

                // 2. Clear browser cache và storage
                console.log('🔄 Đang clear browser cache...');
                try {
                    await page.evaluate(() => {
                        // Clear localStorage
                        window.localStorage.clear();
                        // Clear sessionStorage
                        window.sessionStorage.clear();
                        // Clear cookies (client-side)
                        document.cookie.split(";").forEach(function(c) {
                            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
                        });
                    });
                    console.log('✓ Đã clear browser storage');
                } catch (error) {
                    console.log('⚠️ Lỗi clear storage:', error.message);
                }
            }

            // 3. Clear session files
            console.log('🔄 Đang clear session files...');
            clearSessionData();

            console.log('✅ Hoàn thành logout và clear session');
            return true;

        } catch (error) {
            console.error('❌ Lỗi logout và clear session:', error.message);
            return false;
        }
    }

    // Log email vào dòng mới trong sheet
    async logEmailToSequentialColumns(email, duration) {
        try {
            if (!this.currentAccount) {
                throw new Error('Không có tài khoản hiện tại');
            }

            console.log(`📝 Log email ${email} (${duration}) vào dòng mới...`);

            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];

            // Tạo dòng mới cho email này
            const newRow = await accountsSheet.addRow({
                'ID': '', // Để trống vì đây là log email, không phải account
                'Account': `[LOG] ${this.currentAccount.username} (ID: ${this.currentAccount.id})`,
                'Current Count': '',
                'Max Limit': '',
                'Status': '',
                'Last Used': new Date().toISOString(),
                'Email': email,
                'Date Added': new Date().toISOString().split('T')[0],
                'Duration': duration
            });

            console.log(`✓ Đã log email vào dòng mới: ${email} (${duration}) - Account ID: ${this.currentAccount.id}`);
            return true;

        } catch (error) {
            console.error('❌ Lỗi log email:', error.message);
            return false;
        }
    }

    // Rollback count khi có lỗi
    async rollbackCount() {
        try {
            if (!this.currentAccount) {
                console.log('⚠️ Không có tài khoản hiện tại để rollback');
                return false;
            }

            console.log(`🔄 Rollback count cho tài khoản: ${this.currentAccount.username}`);

            // Giảm count xuống 1
            if (this.currentAccount.currentCount > 0) {
                this.currentAccount.currentCount--;

                // Cập nhật vào Google Sheet
                const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
                const rows = await accountsSheet.getRows();

                const targetRow = rows.find(row => {
                    const rowId = row.get('ID');
                    return rowId && rowId.toString() === this.currentAccount.id.toString();
                });

                if (targetRow) {
                    targetRow.set('Current Count', this.currentAccount.currentCount);
                    await targetRow.save();
                    console.log(`✓ Đã rollback count: ${this.currentAccount.username} (${this.currentAccount.currentCount}/${this.currentAccount.maxLimit})`);
                } else {
                    console.error(`❌ Không tìm thấy row để rollback cho ${this.currentAccount.username}`);
                }
            }

            return true;

        } catch (error) {
            console.error('❌ Lỗi rollback count:', error.message);
            return false;
        }
    }

    // Làm sạch tài khoản trùng lặp
    async cleanDuplicateAccounts() {
        try {
            console.log('🧹 Đang làm sạch tài khoản trùng lặp...');

            const accountsSheet = this.doc.sheetsById[this.accountsSheetGid];
            const rows = await accountsSheet.getRows();

            const seenAccounts = new Map();
            const duplicateRows = [];

            for (const row of rows) {
                const account = row.get('Account');
                if (account && account.includes('|')) {
                    const [username] = account.split('|');
                    const cleanUsername = username.trim();

                    if (seenAccounts.has(cleanUsername)) {
                        console.log(`🔍 Tìm thấy tài khoản trùng lặp: ${cleanUsername} (Row: ${row.rowIndex})`);
                        duplicateRows.push(row);
                    } else {
                        seenAccounts.set(cleanUsername, row);
                    }
                }
            }

            if (duplicateRows.length > 0) {
                console.log(`🗑️ Sẽ xóa ${duplicateRows.length} tài khoản trùng lặp...`);

                for (const row of duplicateRows) {
                    const account = row.get('Account');
                    const username = account.split('|')[0].trim();
                    console.log(`  - Xóa: ${username} (Row: ${row.rowIndex})`);
                    await row.delete();
                }

                console.log('✅ Đã xóa tất cả tài khoản trùng lặp');

                // Reload accounts
                await this.loadAccounts();
            } else {
                console.log('✅ Không có tài khoản trùng lặp');
            }

            return true;

        } catch (error) {
            console.error('❌ Lỗi làm sạch tài khoản trùng lặp:', error.message);
            return false;
        }
    }

    // CRITICAL FIX: Lưu vị trí ID hiện tại
    async saveCurrentAccountPosition() {
        try {
            const fs = require('fs').promises;
            const path = require('path');

            const positionData = {
                currentAccountId: this.currentAccount ? this.currentAccount.id : null,
                lastUpdated: new Date().toISOString(),
                timestamp: Date.now()
            };

            const positionFile = path.join(__dirname, 'user-data', 'account-position.json');

            // Tạo thư mục nếu chưa có
            const dir = path.dirname(positionFile);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(positionFile, JSON.stringify(positionData, null, 2));
            console.log(`💾 Đã lưu vị trí tài khoản: ID ${positionData.currentAccountId}`);

        } catch (error) {
            console.log(`⚠️ Lỗi lưu vị trí tài khoản:`, error.message);
        }
    }

    // CRITICAL FIX: Load vị trí ID đã lưu
    async loadSavedAccountPosition() {
        try {
            const fs = require('fs').promises;
            const path = require('path');

            const positionFile = path.join(__dirname, 'user-data', 'account-position.json');

            const data = await fs.readFile(positionFile, 'utf8');
            const positionData = JSON.parse(data);

            console.log(`📂 Đã load vị trí tài khoản: ID ${positionData.currentAccountId}`);
            console.log(`📅 Last updated: ${positionData.lastUpdated}`);

            return positionData.currentAccountId;

        } catch (error) {
            console.log(`📂 Không có vị trí tài khoản đã lưu (file mới)`);
            return null;
        }
    }

    // CRITICAL FIX: Khởi tạo với vị trí đã lưu
    async initializeWithSavedPosition() {
        try {
            const savedAccountId = await this.loadSavedAccountPosition();

            if (savedAccountId) {
                // Tìm account với ID đã lưu
                const savedAccount = this.accounts.find(acc => parseInt(acc.id) === parseInt(savedAccountId));

                if (savedAccount && savedAccount.status === 'On' && savedAccount.currentCount < savedAccount.maxLimit) {
                    this.currentAccount = savedAccount;
                    this.currentAccountIndex = this.accounts.findIndex(acc => acc === this.currentAccount);
                    console.log(`✅ Khôi phục tài khoản đã lưu: ID ${savedAccountId} (${savedAccount.currentCount}/${savedAccount.maxLimit})`);
                    return true;
                } else {
                    console.log(`⚠️ Tài khoản đã lưu ID ${savedAccountId} không khả dụng, chọn tài khoản mới`);
                }
            }

            // Nếu không có hoặc không khả dụng, chọn tài khoản mới
            return await this.selectNextAvailableAccount();

        } catch (error) {
            console.log(`⚠️ Lỗi khôi phục vị trí:`, error.message);
            return await this.selectNextAvailableAccount();
        }
    }

    // CRITICAL FIX: Lấy current account mà KHÔNG reload (để tránh logout khi đã có UI)
    getCurrentAccountForLogin() {
        if (!this.currentAccount) {
            throw new Error('Chưa có current account. Cần gọi initialize() trước.');
        }

        console.log(`🎯 Sử dụng current account cho login: ID ${this.currentAccount.id} (${this.currentAccount.username})`);
        console.log(`📊 Account status: ${this.currentAccount.currentCount}/${this.currentAccount.maxLimit} - ${this.currentAccount.status}`);

        return this.currentAccount;
    }
}

module.exports = AccountManager;
