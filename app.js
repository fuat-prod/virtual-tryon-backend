require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 5000;

// Replicate client
const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://127.0.0.1:3000', 
        'https://virtual-tryon-frontend.vercel.app',
        'https://virtual-tryon-frontend-eaj0ujlq2-fuats-projects-eb0aadc0.vercel.app',
        '*'
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use('/results', express.static(path.join(__dirname, 'public', 'results')));

// Multer konfigürasyonu
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

// Görsel dosyasını base64'e çevirme
const imageToBase64 = async (imagePath) => {
    try {
        console.log('📷 Reading image:', imagePath);
        const imageBuffer = await fs.readFile(imagePath);
        console.log('📊 Buffer size:', imageBuffer.length);
        const base64 = imageBuffer.toString('base64');
        const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        console.log('✅ Base64 conversion successful, size:', dataUrl.length);
        return dataUrl;
    } catch (error) {
        console.error('❌ Base64 conversion error:', error);
        throw new Error(`Base64 conversion error: ${error.message}`);
    }
};

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

// AI Virtual Try-On İşlemi - IDM-VTON (with dynamic category)
const processVirtualTryOnAI = async (userImagePath, clothingImagePath, category) => {
    try {
        console.log('🎯 IDM-VTON Virtual Try-On starting...');
        console.log(`👤 User image: ${userImagePath}`);
        console.log(`👕 Clothing image: ${clothingImagePath}`);
        console.log(`📂 Category: ${category}`);
        
        // Category validation
        if (!validateCategory(category)) {
            throw new Error(`Invalid category: ${category}. Must be one of: upper_body, lower_body, dresses`);
        }
        
        // Görselleri base64'e çevir
        const humanImage = await imageToBase64(userImagePath);
        const garmImage = await imageToBase64(clothingImagePath);
        
        console.log('📤 IDM-VTON Replicate API call...');
        
        // IDM-VTON modeli ile işle - Dynamic category
        const output = await replicate.run(
            "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
            {
                input: {
                    human_img: humanImage,
                    garm_img: garmImage,
                    category: category, // Dynamic category from user selection
                    garment_des: `${category.replace('_', ' ')} clothing item`,
                    crop: false,
                    seed: Math.floor(Math.random() * 1000000),
                    steps: 30,
                    mask_only: false,
                    force_dc: false
                }
            }
        );
        
        console.log('🔍 DEBUG - IDM Output type:', typeof output);
        console.log('🔍 DEBUG - IDM Output value:', output);
        console.log('🔍 DEBUG - Is array?', Array.isArray(output));
        console.log('🔍 DEBUG - First element:', Array.isArray(output) ? output[0] : output);
        
        // Output array formatında gelir
        let resultUrl;
        if (Array.isArray(output) && output.length > 0) {
            resultUrl = output[0];
            console.log('📝 Array result URL:', resultUrl);
        } else {
            resultUrl = output;
            console.log('📝 Direct result:', resultUrl);
        }
        
        console.log('🎉 IDM-VTON processing completed!');
        console.log('📥 Final result URL:', resultUrl);
        
        return resultUrl;
        
    } catch (error) {
        console.error('💥 IDM-VTON processing error:', error);
        throw new Error(`IDM-VTON processing failed: ${error.message}`);
    }
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

// Ana API Endpoint - Updated with category support
app.post('/api/process-image', upload.fields([
    { name: 'userImage', maxCount: 1 },
    { name: 'clothingImage', maxCount: 1 }
]), async (req, res) => {
    console.log('📥 New Virtual Try-On request received');
    
    try {
        // Dosya kontrolü
        if (!req.files || !req.files.userImage || !req.files.clothingImage) {
            return res.status(400).json({
                success: false,
                error: 'Both photos must be uploaded'
            });
        }
        
        // Category kontrolü
        const category = req.body.category || 'upper_body'; // Default to upper_body if not provided
        if (!validateCategory(category)) {
            return res.status(400).json({
                success: false,
                error: `Invalid category: ${category}. Must be one of: upper_body, lower_body, dresses`
            });
        }
        
        const userImageFile = req.files.userImage[0];
        const clothingImageFile = req.files.clothingImage[0];
        
        console.log(`✅ Files received:`);
        console.log(`   👤 ${userImageFile.filename} (${(userImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   👕 ${clothingImageFile.filename} (${(clothingImageFile.size/1024/1024).toFixed(2)} MB)`);
        console.log(`   📂 Category: ${category}`);
        
        // AI ile işle - category parameter added
        const aiResult = await processVirtualTryOnAI(
            userImageFile.path,
            clothingImageFile.path,
            category
        );

        // IDM-VTON array döndürürse ilk elemanı al
        const aiResultUrl = Array.isArray(aiResult) ? aiResult[0] : aiResult;
        console.log('🔍 AI Result type:', typeof aiResult);
        console.log('🔍 AI Result:', aiResult);
        
        // Sonuç görselini lokal olarak kaydet (opsiyonel)
        const resultFileName = `ai-result-${category}-${Date.now()}-${uuidv4()}.jpg`;
        const localResultPath = path.join(__dirname, 'public', 'results', resultFileName);
        
        try {
            await downloadImageFromUrl(aiResultUrl, localResultPath);
            // Lokal URL oluştur
            const localResultUrl = `${req.protocol}://${req.get('host')}/results/${resultFileName}`;
            
            console.log(`💾 Result saved locally: ${localResultUrl}`);
            
            // Geçici dosyaları temizle
            await fs.unlink(userImageFile.path);
            await fs.unlink(clothingImageFile.path);
            console.log('🗑️ Temporary files cleaned');
            
            // Başarılı yanıt (lokal URL ile)
            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: localResultUrl, // Lokal URL
                originalUrl: aiResultUrl, // Replicate URL
                fileName: resultFileName,
                model: 'IDM-VTON',
                category: category,
                timestamp: new Date().toISOString()
            });
            
        } catch (downloadError) {
            console.warn('⚠️ Local save error, using Replicate URL:', downloadError.message);
            
            // Lokal kayıt başarısız, direkt Replicate URL'i döndür
            res.json({
                success: true,
                message: `AI Virtual Try-On completed for ${category.replace('_', ' ')}! 🎉`,
                imageUrl: aiResultUrl, // Direkt Replicate URL
                fileName: `external-${category}-${Date.now()}.jpg`,
                model: 'IDM-VTON',
                category: category,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('💥 API Error:', error);
        
        // Hata durumunda geçici dosyaları temizle
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

// Test endpoint'leri
app.get('/api/health', (req, res) => {
    res.json({
        status: '✅ Healthy',
        ai: 'IDM-VTON Ready',
        categories: ['upper_body', 'lower_body', 'dresses'],
        timestamp: new Date().toISOString(),
        replicate: process.env.REPLICATE_API_TOKEN ? '🔑 Connected' : '❌ Token Missing'
    });
});

app.get('/test-ai', async (req, res) => {
    try {
        // Basit Replicate bağlantı testi
        const response = await replicate.models.list();
        res.json({
            message: '🤖 Replicate connection successful!',
            modelCount: response.results?.length || 0
        });
    } catch (error) {
        res.status(500).json({
            error: 'Replicate connection error',
            details: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        message: '🎭 AI Virtual Try-On API v2.0',
        model: 'IDM-VTON (HuggingFace)',
        platform: 'Replicate',
        status: 'ready',
        categories: ['upper_body', 'lower_body', 'dresses'],
        endpoints: {
            health: 'GET /api/health',
            testAI: 'GET /test-ai',
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI Model: IDM-VTON (HuggingFace)
🔗 Platform: Replicate
📍 API: http://localhost:${PORT}/api/process-image
📍 Health: http://localhost:${PORT}/api/health
📍 AI Test: http://localhost:${PORT}/test-ai
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 Replicate Token: ${process.env.REPLICATE_API_TOKEN ? '✅ Configured' : '❌ Missing'}
💰 Estimated Cost: ~$0.05 per image
⏱️ Processing Time: ~30 seconds
🏷️ Categories: Upper Body | Lower Body | Dresses
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `);
        });
        
    } catch (error) {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }
};

startServer();
