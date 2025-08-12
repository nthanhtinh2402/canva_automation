const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class SheetsManager {
    constructor() {
        this.doc = null;
        this.oneMonthSheetGid = '0'; // Sheet "1 Month"
        this.oneYearSheetGid = '1996584998'; // Sheet "1 Year"
        this.isInitialized = false;
        // Config cache (key/value or column-based) from Config sheet
        this._configCache = { map: null, ts: 0 };
        this._configTtlMs = Number(process.env.CONFIG_CACHE_TTL_MS || 60000);
        this._configSheetGid = process.env.CONFIG_SHEET_GID || null; // optional
        this._configSheetTitle = process.env.CONFIG_SHEET_TITLE || 'Config';
        // Column-based config (using specific columns in the given sheet GID)
        this._successCol = process.env.SUCCESS_MSG_TEMPLATE_COL || null;
        this._failCol = process.env.FAIL_MSG_TEMPLATE_COL || null;
        this._configRowIndex = Number(process.env.CONFIG_ROW_INDEX || 1); // 1-based index
    }

    async initialize() {
        try {
            console.log('Đang khởi tạo Google Sheets connection...');

            // Khởi tạo JWT auth
            const serviceAccountAuth = new JWT({
                email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            // Khởi tạo document
            this.doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
            await this.doc.loadInfo();

            console.log(`✓ Đã kết nối Google Sheet: ${this.doc.title}`);
            this.isInitialized = true;

            return true;
        } catch (error) {
            console.error('❌ Lỗi khởi tạo Google Sheets:', error.message);
            throw error;
        }
    }

    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async logOneMonth(email, account) {
        try {
            await this.ensureInitialized();

            console.log(`📝 Ghi log vào hàng account: ${account.username}`);

            const sheet = this.doc.sheetsById[this.oneMonthSheetGid];
            if (!sheet) {
                throw new Error(`Sheet với GID ${this.oneMonthSheetGid} không tồn tại`);
            }

            const rows = await sheet.getRows();

            // Tìm hàng của account hiện tại
            let accountRow = rows.find(row => {
                const rowAccount = row.get('Account');
                return rowAccount && rowAccount.includes(account.username);
            });

            if (accountRow) {
                // Kiểm tra xem email đã tồn tại chưa
                const existingEmails = [
                    accountRow.get('Email 1'),
                    accountRow.get('Email 2'),
                    accountRow.get('Email 3'),
                    accountRow.get('Email 4')
                ].filter(email => email && email.trim());

                if (existingEmails.includes(email)) {
                    throw new Error(`Email ${email} đã được mời trước đó`);
                }

                // Tìm cột trống để thêm email
                const emailColumns = ['Email 1', 'Email 2', 'Email 3', 'Email 4'];
                let addedToExistingRow = false;

                for (const column of emailColumns) {
                    const currentValue = accountRow.get(column);
                    if (!currentValue || currentValue.trim() === '') {
                        accountRow.set(column, email);
                        accountRow.set('Date Added', new Date().toISOString().split('T')[0]);
                        await accountRow.save();
                        console.log(`✓ Đã thêm ${email} vào cột ${column} của hàng account`);
                        addedToExistingRow = true;
                        break;
                    }
                }

                if (!addedToExistingRow) {
                    console.log('📝 Hàng account đã đầy, tạo row mới cho:', email);
                    await this.createNewRowForEmail(sheet, email, account);
                }
            } else {
                // Tạo hàng mới cho account
                console.log('📝 Tạo hàng mới cho account:', account.username);
                await sheet.addRow({
                    'Account': `${account.username}|${account.password}`,
                    'Email 1': email,
                    'Date Added': new Date().toISOString().split('T')[0],
                    'Duration': '1 Month'
                });
                console.log(`✓ Đã tạo hàng mới cho account: ${account.username}`);
            }

            console.log(`✅ Đã ghi log 1 Month thành công cho: ${email}`);
            return true;

        } catch (error) {
            console.error(`Lỗi ghi log 1 Month: ${error.message}`);
            throw error;
        }
    }

    async logOneYear(email, account) {
        try {
            await this.ensureInitialized();

            console.log(`📝 Ghi log vào hàng account: ${account.username}`);

            const sheet = this.doc.sheetsById[this.oneYearSheetGid];
            if (!sheet) {
                throw new Error(`Sheet với GID ${this.oneYearSheetGid} không tồn tại`);
            }

            const rows = await sheet.getRows();

            // Tìm hàng của account hiện tại
            let accountRow = rows.find(row => {
                const rowAccount = row.get('Account');
                return rowAccount && rowAccount.includes(account.username);
            });

            if (accountRow) {
                // Kiểm tra xem email đã tồn tại chưa
                const existingEmails = [
                    accountRow.get('Email 1'),
                    accountRow.get('Email 2'),
                    accountRow.get('Email 3'),
                    accountRow.get('Email 4')
                ].filter(email => email && email.trim());

                if (existingEmails.includes(email)) {
                    throw new Error(`Email ${email} đã được mời trước đó`);
                }

                // Tìm cột trống để thêm email
                const emailColumns = ['Email 1', 'Email 2', 'Email 3', 'Email 4'];
                let addedToExistingRow = false;

                for (const column of emailColumns) {
                    const currentValue = accountRow.get(column);
                    if (!currentValue || currentValue.trim() === '') {
                        accountRow.set(column, email);
                        accountRow.set('Date Added', new Date().toISOString().split('T')[0]);
                        await accountRow.save();
                        console.log(`✓ Đã thêm ${email} vào cột ${column} của hàng account`);
                        addedToExistingRow = true;
                        break;
                    }
                }

                if (!addedToExistingRow) {
                    console.log('📝 Hàng account đã đầy, tạo row mới cho:', email);
                    await this.createNewRowForEmail(sheet, email, account);
                }
            } else {
                // Tạo hàng mới cho account
                console.log('📝 Tạo hàng mới cho account:', account.username);
                await sheet.addRow({
                    'Account': `${account.username}|${account.password}`,
                    'Email 1': email,
                    'Date Added': new Date().toISOString().split('T')[0],
                    'Duration': '1 Year'
                });
                console.log(`✓ Đã tạo hàng mới cho account: ${account.username}`);
            }

            console.log(`✅ Đã ghi log 1 Year thành công cho: ${email}`);
            return true;

        } catch (error) {
            console.error(`Lỗi ghi log 1 Year: ${error.message}`);
            throw error;
        }
    }

    async createNewRowForEmail(sheet, email, account) {
        try {
            await sheet.addRow({
                'Account': `${account.username}|${account.password}`,
                'Email 1': email,
                'Date Added': new Date().toISOString().split('T')[0],
                'Duration': sheet.title.includes('Month') ? '1 Month' : '1 Year'
            });
            console.log(`✓ Đã tạo row mới cho: ${email}`);
            return true;
        } catch (error) {
            console.error(`Lỗi tạo row mới: ${error.message}`);
            throw error;
        }
    }

    async getStats() {
        try {
            await this.ensureInitialized();

            const oneMonthSheet = this.doc.sheetsById[this.oneMonthSheetGid];
            const oneYearSheet = this.doc.sheetsById[this.oneYearSheetGid];

            const oneMonthRows = await oneMonthSheet.getRows();
            const oneYearRows = await oneYearSheet.getRows();

            return {
                oneMonth: {
                    totalRows: oneMonthRows.length,
                    sheetTitle: oneMonthSheet.title
                },
                oneYear: {
                    totalRows: oneYearRows.length,
                    sheetTitle: oneYearSheet.title
                }
            };
        } catch (error) {
            console.error('Lỗi lấy stats:', error.message);
            throw error;
        }
    }

    async updateTaskStatus(email, duration, status = 'completed') {
        try {
            await this.ensureInitialized();

            const sheetGid = duration === '1m' ? this.oneMonthSheetGid : this.oneYearSheetGid;
            const sheet = this.doc.sheetsById[sheetGid];

            if (!sheet) {
                console.log(`⚠️ Sheet không tồn tại cho duration: ${duration}`);
                return false;
            }

            const rows = await sheet.getRows();

            // Tìm row chứa email này
            for (const row of rows) {
                const emailColumns = ['Email 1', 'Email 2', 'Email 3', 'Email 4'];
                for (const column of emailColumns) {
                    if (row.get(column) === email) {
                        row.set('Status', status);
                        row.set('Updated At', new Date().toISOString());
                        await row.save();
                        console.log(`✓ Đã cập nhật status cho ${email}: ${status}`);
                        return true;
                    }
                }
            }

            console.log(`⚠️ Không tìm thấy email ${email} để cập nhật status`);
            return false;

        } catch (error) {
            console.error(`Lỗi cập nhật status: ${error.message}`);
            return false;
        }
    }

    // Load config (key/value) from a dedicated sheet (by title or GID)
    async loadConfigMap(force = false) {
        await this.ensureInitialized();
        const now = Date.now();
        if (!force && this._configCache.map && (now - this._configCache.ts) < this._configTtlMs) {
            return this._configCache.map;
        }

        let sheet = null;
        if (this._configSheetGid && this.doc.sheetsById[this._configSheetGid]) {
            sheet = this.doc.sheetsById[this._configSheetGid];
        } else {
            // fallback by title
            sheet = this.doc.sheetsByTitle[this._configSheetTitle];
        }

        if (!sheet) {
            console.log('⚠️ Không tìm thấy sheet cấu hình (Config). Bỏ qua, sẽ dùng .env');
            this._configCache = { map: null, ts: now };
            return null;
        }

        const rows = await sheet.getRows();
        const map = {};
        for (const row of rows) {
            const key = row.get('Key') || row.get('key') || row.get('KEY');
            const val = row.get('Value') || row.get('value') || row.get('VAL') || row.get('VALUE');
            if (key) map[String(key).trim()] = (val ?? '').toString();
        }
        this._configCache = { map, ts: now };
        return map;
    }

    async getConfigValue(key, fallback = null) {
        try {
            const map = await this.loadConfigMap(false);
            if (map && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
        } catch {}
        return fallback;
    }


    // Column-based getters (read directly from a specific sheet/GID and column headers)
    async _getFromColumns() {
        await this.ensureInitialized();
        if (!this._configSheetGid || !this.doc.sheetsById[this._configSheetGid]) return null;
        const sheet = this.doc.sheetsById[this._configSheetGid];
        const rows = await sheet.getRows({ offset: this._configRowIndex - 1, limit: 1 });
        if (!rows || !rows[0]) return null;
        const row = rows[0];
        const data = {};
        if (this._successCol) data.SUCCESS_MSG_TEMPLATE = row.get(this._successCol) || null;
        if (this._failCol) data.FAIL_MSG_TEMPLATE = row.get(this._failCol) || null;
        return data;
    }

    async getSuccessMessageTemplate(defaultTpl) {
        // Priority: column-based → key/value sheet → default
        try {
            const colData = await this._getFromColumns();
            if (colData && colData.SUCCESS_MSG_TEMPLATE) return colData.SUCCESS_MSG_TEMPLATE;
        } catch {}
        return await this.getConfigValue('SUCCESS_MSG_TEMPLATE', defaultTpl);
    }

    async getFailMessageTemplate(defaultTpl) {
        // Priority: column-based → key/value sheet → default
        try {
            const colData = await this._getFromColumns();
            if (colData && colData.FAIL_MSG_TEMPLATE) return colData.FAIL_MSG_TEMPLATE;
        } catch {}
        return await this.getConfigValue('FAIL_MSG_TEMPLATE', defaultTpl);
    }





    // Alias cho updateTaskStatus để tương thích
    async updateStatus(email, duration, status = 'completed') {
        return await this.updateTaskStatus(email, duration, status);
    }
}

module.exports = SheetsManager;
