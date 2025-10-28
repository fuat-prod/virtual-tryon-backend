require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { useFreeTrial, useCredits } = require('./services/auth/generationService');


// Yeni API Manager sistemi
const apiManager = require('./services/apiManager');
const { supabaseAdmin } = require('./config/supabase');
const authRoutes = require('./services/auth/authRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://localhost:5000',
        'http://127.0.0.1:3000', 
        'http://127.0.0.1:5000',
        'https://virtual-tryon-frontend.vercel.app',
        'https://www.dressai.app',
        'https://dressai.app' 
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// 🔔 PADDLE WEBHOOK ROUTE (MUST BE BEFORE express.json()!)
const paddleWebhookRouter = require('./routes/paddleWebhook');
app.use('/api/paddle/webhook', paddleWebhookRouter);

// JSON middleware (after webhook route)
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
    
    const startTime = Date.now();
    
    try {
        // ==========================================
        // 1. USER AUTHENTICATION CHECK
        // ==========================================
        const userId = req.body.userId;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID is required',
                code: 'AUTH_REQUIRED'
            });
        }

        // User bilgilerini al
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('id, credits, free_trials_used, free_trials_limit, segment')
            .eq('id', userId)
            .single();

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Credits veya free trial kontrolü
        const hasFreeTrial = user.free_trials_used < user.free_trials_limit;
        const hasCredits = user.credits > 0;

        if (!hasFreeTrial && !hasCredits) {
            return res.status(403).json({
                success: false,
                error: 'No free trials or credits remaining',
                code: 'NO_CREDITS',
                user: {
                    credits: user.credits,
                    free_trials_used: user.free_trials_used,
                    free_trials_limit: user.free_trials_limit
                }
            });
        }

        console.log(`👤 User: ${userId.slice(0, 8)}... (${user.segment})`);
        console.log(`💳 Credits: ${user.credits} | Free Trials: ${user.free_trials_used}/${user.free_trials_limit}`);

        // ==========================================
        // 2. FILE VALIDATION
        // ==========================================
        if (!req.files || !req.files.userImage || !req.files.clothingImage) {
            return res.status(400).json({
                success: false,
                error: 'Both photos must be uploaded'
            });
        }
        
        const category = req.body.category || 'upper_body';
        if (!validateCategory(category)) {
            return res.status(400).json({
                success: false,
                error: `Invalid category: ${category}. Must be one of: upper_body, lower_body, dresses`
            });
        }

        const selectedApi = req.body.api;
        const userImageFile = req.files.userImage[0];
        const clothingImageFile = req.files.clothingImage[0];
        
        console.log(`✅ Files received:`);
        console.log(`   👤 ${userImageFile.filename} (${(userImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   👕 ${clothingImageFile.filename} (${(clothingImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   📂 Category: ${category}`);
        if (selectedApi) console.log(`   🎯 Requested API: ${selectedApi}`);

        // ==========================================
        // 3. AI PROCESSING
        // ==========================================
        let apiResult;
        
        if (selectedApi) {
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
            apiResult = await apiManager.autoProcess(
                userImageFile.path,
                clothingImageFile.path,
                category
            );
        }

        const resultUrl = apiResult.result;
        const processingTime = Math.floor((Date.now() - startTime) / 1000);
        
        console.log(`🎉 Processing completed with ${apiResult.usedApi}!`);
        console.log(`⏱️ Processing time: ${processingTime}s`);
        
        // ==========================================
        // 4. SAVE RESULT LOCALLY
        // ==========================================
        const resultFileName = `ai-result-${category}-${Date.now()}-${uuidv4()}.jpg`;
        const localResultPath = path.join(__dirname, 'public', 'results', resultFileName);
        
        try {
            await downloadImageFromUrl(resultUrl, localResultPath);
            const localResultUrl = `${req.protocol}://${req.get('host')}/results/${resultFileName}`;
            
            console.log(`💾 Result saved locally: ${localResultUrl}`);
            
            // ==========================================
            // 5. DATABASE: USE FREE TRIAL OR CREDITS
            // ==========================================
            let generationResult;
            const generationData = {
                category: category,
                api_used: apiResult.usedApi,
                person_image_url: userImageFile.filename,
                garment_image_url: clothingImageFile.filename,
                result_image_url: localResultUrl,
                processing_time_seconds: processingTime
            };

            if (hasFreeTrial) {
                // Use free trial
                generationResult = await useFreeTrial(userId, generationData);
                console.log('🎁 Free trial used');
            } else {
                // Use credits
                generationResult = await useCredits(userId, generationData, 1);
                console.log(`💳 1 credit used (${generationResult.credits_remaining} remaining)`);
            }

            if (!generationResult.success) {
                console.error('Database save error:', generationResult.error);
            }

            // Clean temporary files
            await fs.unlink(userImageFile.path);
            await fs.unlink(clothingImageFile.path);
            console.log('🗑️ Temporary files cleaned');
            
            // ==========================================
            // 6. SUCCESS RESPONSE
            // ==========================================
            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: localResultUrl,
                originalUrl: resultUrl,
                fileName: resultFileName,
                usedApi: apiResult.usedApi,
                fallback: apiResult.fallback || false,
                category: category,
                timestamp: new Date().toISOString(),
                // User info
                usedFreeTrial: hasFreeTrial && !hasCredits,
                creditsRemaining: generationResult.credits_remaining || user.credits,
                freeTrialsRemaining: user.free_trials_limit - (user.free_trials_used + (hasFreeTrial ? 1 : 0))
            });
            
        } catch (downloadError) {
            console.warn('⚠️ Local save error, using direct URL:', downloadError.message);
            
            // Return direct URL on save failure (still record in database)
            let generationResult;
            const generationData = {
                category: category,
                api_used: apiResult.usedApi,
                person_image_url: userImageFile.filename,
                garment_image_url: clothingImageFile.filename,
                result_image_url: resultUrl,
                processing_time_seconds: processingTime
            };

            if (hasFreeTrial) {
                generationResult = await useFreeTrial(userId, generationData);
            } else {
                generationResult = await useCredits(userId, generationData, 1);
            }

            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: resultUrl,
                originalUrl: resultUrl,
                usedApi: apiResult.usedApi,
                fallback: apiResult.fallback || false,
                category: category,
                timestamp: new Date().toISOString(),
                usedFreeTrial: hasFreeTrial && !hasCredits,
                creditsRemaining: generationResult.credits_remaining || user.credits,
                freeTrialsRemaining: user.free_trials_limit - (user.free_trials_used + (hasFreeTrial ? 1 : 0))
            });
        }
        
    } catch (error) {
        console.error('❌ Processing error:', error);
        
        // Clean files on error
        try {
            if (req.files?.userImage?.[0]?.path) {
                await fs.unlink(req.files.userImage[0].path);
            }
            if (req.files?.clothingImage?.[0]?.path) {
                await fs.unlink(req.files.clothingImage[0].path);
            }
        } catch (cleanError) {
            console.error('File cleanup error:', cleanError);
        }
        
        res.status(500).json({
            success: false,
            error: 'Processing failed',
            details: error.message,
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



// AUTH ROUTES
// ==========================================
app.use('/api/auth', authRoutes);


startServer();