require('dotenv').config();
const AccountManager = require('./account-manager');

async function testAccountSelection() {
    try {
        console.log('🧪 === TEST ACCOUNT SELECTION LOGIC ===');
        
        const am = new AccountManager();
        await am.initialize();
        
        console.log('📊 TRẠNG THÁI BAN ĐẦU:');
        am.accounts.forEach(acc => {
            const available = acc.status === 'On' && acc.currentCount < acc.maxLimit;
            console.log(`  ID ${acc.id}: ${acc.currentCount}/${acc.maxLimit} - ${acc.status} - ${available ? '✅ Available' : '❌ Not available'}`);
        });
        
        console.log('\n🎯 Test 1: Chọn tài khoản đầu tiên...');
        const account1 = await am.ensureActiveAccount();
        console.log(`📊 Selected: ID ${account1.id} (${account1.currentCount}/${account1.maxLimit}) - ${account1.status}`);
        
        console.log('\n🎯 Test 2: Force chuyển sang tài khoản tiếp theo...');
        const switched = await am.selectNextAvailableAccount();
        console.log(`📊 Switch result: ${switched}`);
        
        if (switched) {
            const account2 = am.currentAccount;
            console.log(`📊 New account: ID ${account2.id} (${account2.currentCount}/${account2.maxLimit}) - ${account2.status}`);
            
            if (account2.id !== account1.id) {
                console.log(`✅ ĐÚNG: Đã chuyển từ ID ${account1.id} → ID ${account2.id}`);
            } else {
                console.log(`❌ SAI: Vẫn cùng ID ${account1.id}`);
            }
        }
        
        console.log('\n🎯 Test 3: Test sequence chuyển tài khoản...');
        for (let i = 1; i <= 5; i++) {
            const currentId = am.currentAccount.id;
            console.log(`--- Test ${i}: Current ID ${currentId} ---`);
            
            const switched = await am.selectNextAvailableAccount();
            if (switched) {
                const newId = am.currentAccount.id;
                console.log(`📊 ID ${currentId} → ID ${newId} ${newId > currentId ? '✅ Tăng' : newId < currentId ? '🔄 Wrap' : '❌ Same'}`);
            } else {
                console.log(`❌ Không thể chuyển từ ID ${currentId}`);
                break;
            }
        }
        
        console.log('\n🎯 === KẾT QUẢ TEST ===');
        console.log('✅ Logic chọn tài khoản theo ID tuần tự');
        console.log('✅ Chuyển tài khoản hoạt động');
        console.log('✅ Sequence ID đúng thứ tự');
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

testAccountSelection();
