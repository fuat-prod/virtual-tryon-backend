require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Yeni API Manager sistemi
const apiManager = require('./services/apiManager');
const { supabaseAdmin } = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://127.0.0.1:3000', 
        'https://virtual-tryon-frontend.vercel.app',
        '*'
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use('/results', express.static(path.join(__dirname, 'public', 'results')));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Multer configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.access('uploads');
        } catch {
            await fs.mkdir('uploads', { recursive: true });
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported format: ${file.mimetype}`), false);
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});

// URL'den görsel indirme
const downloadImageFromUrl = async (imageUrl, outputPath) => {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(outputPath, buffer);
        
        console.log(`✅ Image downloaded: ${outputPath}`);
        return outputPath;
    } catch (error) {
        throw new Error(`Image download error: ${error.message}`);
    }
};

// Category validation
const validateCategory = (category) => {
    const validCategories = ['upper_body', 'lower_body', 'dresses'];
    return validCategories.includes(category);
};

// Klasör oluşturma
const createDirectories = async () => {
    const dirs = ['uploads', 'public', 'public/results'];
    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
            console.log(`📁 ${dir} folder created`);
        }
    }
};

// ========================================
// 🆕 UPDATED API ENDPOINT - Multi-API Support
// ========================================
app.post('/api/process-image', upload.fields([
    { name: 'userImage', maxCount: 1 },
    { name: 'clothingImage', maxCount: 1 }
]), async (req, res) => {
    console.log('📥 New Virtual Try-On request received');
    
    try {
        // File validation
        if (!req.files || !req.files.userImage || !req.files.clothingImage) {
            return res.status(400).json({
                success: false,
                error: 'Both photos must be uploaded'
            });
        }
        
        // Category validation
        const category = req.body.category || 'upper_body';
        if (!validateCategory(category)) {
            return res.status(400).json({
                success: false,
                error: `Invalid category: ${category}. Must be one of: upper_body, lower_body, dresses`
            });
        }

        // Manuel API seçimi (opsiyonel)
        const selectedApi = req.body.api; // Frontend'den gelebilir
        
        const userImageFile = req.files.userImage[0];
        const clothingImageFile = req.files.clothingImage[0];
        
        console.log(`✅ Files received:`);
        console.log(`   👤 ${userImageFile.filename} (${(userImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   👕 ${clothingImageFile.filename} (${(clothingImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   📂 Category: ${category}`);
        if (selectedApi) console.log(`   🎯 Requested API: ${selectedApi}`);

        // 🆕 API Manager ile işle
        let apiResult;
        
        if (selectedApi) {
            // Manuel API seçimi
            apiResult = await apiManager.processWithSpecificApi(
                selectedApi,
                userImageFile.path,
                clothingImageFile.path,
                category
            );
            apiResult = {
                success: true,
                usedApi: selectedApi,
                result: apiResult
            };
        } else {
            // Otomatik API seçimi
            apiResult = await apiManager.autoProcess(
                userImageFile.path,
                clothingImageFile.path,
                category
            );
        }

        const resultUrl = apiResult.result;
        
        console.log(`🎉 Processing completed with ${apiResult.usedApi}!`);
        console.log(`📥 Result URL: ${resultUrl}`);
        
        // Save result locally
        const resultFileName = `ai-result-${category}-${Date.now()}-${uuidv4()}.jpg`;
        const localResultPath = path.join(__dirname, 'public', 'results', resultFileName);
        
        try {
            await downloadImageFromUrl(resultUrl, localResultPath);
            const localResultUrl = `${req.protocol}://${req.get('host')}/results/${resultFileName}`;
            
            console.log(`💾 Result saved locally: ${localResultUrl}`);
            
            // Clean temporary files
            await fs.unlink(userImageFile.path);
            await fs.unlink(clothingImageFile.path);
            console.log('🗑️ Temporary files cleaned');
            
            // Success response
            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: localResultUrl,
                originalUrl: resultUrl,
                fileName: resultFileName,
                usedApi: apiResult.usedApi,
                fallback: apiResult.fallback || false,
                category: category,
                timestamp: new Date().toISOString()
            });
            
        } catch (downloadError) {
            console.warn('⚠️ Local save error, using direct URL:', downloadError.message);
            
            // Return direct URL on save failure
            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: resultUrl,
                fileName: `external-${category}-${Date.now()}.jpg`,
                usedApi: apiResult.usedApi,
                fallback: apiResult.fallback || false,
                category: category,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('💥 API Error:', error);
        
        // Clean temporary files on error
        if (req.files) {
            const allFiles = [
                ...(req.files.userImage || []),
                ...(req.files.clothingImage || [])
            ];
            
            for (const file of allFiles) {
                try {
                    await fs.unlink(file.path);
                } catch (cleanupError) {
                    console.warn('⚠️ Temp file cleanup error:', cleanupError.message);
                }
            }
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'AI processing error occurred',
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
// 🆕 HEALTH CHECK ENDPOINT - Multi-API Support
// ========================================
app.get('/api/health', async (req, res) => {
    try {
        const apiHealth = await apiManager.healthCheck();
        const activeApis = apiManager.getActiveApis();
        
        res.json({
            status: '✅ Healthy',
            activeApis: activeApis,
            apiStatus: apiHealth,
            categories: ['upper_body', 'lower_body', 'dresses'],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: '❌ Unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
// 🆕 API INFO ENDPOINT
// ========================================
app.get('/api/info', (req, res) => {
    const activeApis = apiManager.getActiveApis();
    
    res.json({
        message: '🎭 AI Virtual Try-On API',
        version: '2.0.0',
        activeApis: activeApis,
        supportedCategories: ['upper_body', 'lower_body', 'dresses'],
        features: [
            'Multi-API Support',
            'Automatic API Selection',
            'Fallback Mechanism',
            'Category-based Optimization'
        ],
        endpoints: {
            health: 'GET /api/health',
            info: 'GET /api/info',
            process: 'POST /api/process-image'
        }
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🎭 AI Virtual Try-On API v2.0',
        features: 'Multi-API Support with Auto Selection',
        status: 'ready',
        endpoints: {
            health: 'GET /api/health',
            info: 'GET /api/info',
            process: 'POST /api/process-image'
        }
    });
});

// Error handling
app.use((error, req, res, next) => {
    console.error('🚨 Middleware Error:', error);
    res.status(500).json({
        success: false,
        error: 'Server error occurred',
        details: error.message
    });
});

// Start server
const startServer = async () => {
    try {
        await createDirectories();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
🚀 AI Virtual Try-On Backend Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Multi-API System: ACTIVE
📍 API: http://localhost:${PORT}/api/process-image
📍 Health: http://localhost:${PORT}/api/health
📍 Info: http://localhost:${PORT}/api/info
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ Categories: Upper Body | Lower Body | Dresses
⚙️ Active APIs: ${apiManager.getActiveApis().join(', ')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `);
        });
        
    } catch (error) {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }
};


// ==========================================
// DATABASE TEST ENDPOINT
// ==========================================
app.get('/api/test-db', async (req, res) => {
  try {
    // Supabase bağlantı testi - paywall config'i oku
    const { data, error } = await supabaseAdmin
      .from('paywall_configs')
      .select('version_name, title, is_active')
      .limit(1)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: '✅ Supabase bağlantısı başarılı!',
      database: 'PostgreSQL via Supabase',
      test_data: data
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      message: '❌ Database bağlantı hatası',
      error: error.message
    });
  }
});

startServer();