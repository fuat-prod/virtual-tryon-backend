// test-apis.js - API Test Script
// require('dotenv').config();
const apiManager = require('./services/apiManager');

async function testApis() {
    console.log('🧪 Starting API Tests...\n');

    try {
        // 1. Health Check
        console.log('1️⃣ Testing Health Check...');
        const health = await apiManager.healthCheck();
        console.log('Health Status:', JSON.stringify(health, null, 2));
        console.log('✅ Health check completed\n');

        // 2. Active APIs
        console.log('2️⃣ Checking Active APIs...');
        const activeApis = apiManager.getActiveApis();
        console.log('Active APIs:', activeApis);
        console.log('✅ Active APIs listed\n');

        // 3. API Selection Test
        console.log('3️⃣ Testing API Selection...');
        const categories = ['upper_body', 'lower_body', 'dresses'];
        
        for (const category of categories) {
            const selectedApi = apiManager.selectBestApi(category);
            console.log(`  ${category}: ${selectedApi}`);
        }
        console.log('✅ API selection tested\n');

        // 4. Configuration Check
        console.log('4️⃣ Checking Configuration...');
        const { apiConfig } = require('./services/apiConfig');
        
        console.log('IDM-VTON Config:');
        console.log(`  - Enabled: ${apiConfig.idmVton.enabled}`);
        console.log(`  - API Key: ${apiConfig.idmVton.apiKey ? '✓ Set' : '✗ Missing'}`);
        
        console.log('\nNano Banana Config:');
        console.log(`  - Enabled: ${apiConfig.nanoBanana.enabled}`);
        console.log(`  - API Key: ${apiConfig.nanoBanana.apiKey ? '✓ Set' : '✗ Missing'}`);
        console.log('✅ Configuration checked\n');

        console.log('🎉 All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run tests
testApis();
