require('dotenv').config();
const AccountManager = require('./account-manager');

async function testSimple() {
    try {
        console.log('🧪 === TEST ĐỠN GIẢN 1 LẦN ===');
        
        const am = new AccountManager();
        await am.initialize();
        
        console.log('📊 Trạng thái ban đầu:');
        console.log(`  ID 1: ${am.accounts[0].currentCount}/${am.accounts[0].maxLimit} - ${am.accounts[0].status}`);
        console.log(`  ID 2: ${am.accounts[1].currentCount}/${am.accounts[1].maxLimit} - ${am.accounts[1].status}`);
        
        // Test 1 lần
        console.log('\n🧪 Bắt đầu test...');
        
        const account = await am.ensureActiveAccount();
        console.log(`📊 Chọn tài khoản: ID ${account.id} (${account.currentCount}/${account.maxLimit}) - ${account.status}`);
        
        const logResult = await am.logEmailToSequentialColumns('test-simple@gmail.com', '1m');
        console.log(`📝 Log email: ${logResult ? 'Thành công' : 'Thất bại'}`);
        
        const countResult = await am.incrementSuccessCount();
        console.log(`📊 Tăng count: ${countResult ? 'Thành công' : 'Thất bại'}`);
        
        const final = am.currentAccount;
        console.log(`\n📊 Kết quả cuối: ID ${final.id} (${final.currentCount}/${final.maxLimit}) - ${final.status}`);
        
        console.log('\n✅ Test hoàn thành!');
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

testSimple();
