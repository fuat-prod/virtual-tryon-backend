/**
 * Nano Banana Service (Google Gemini 2.5 Flash Image)
 * Virtual Try-On with category-specific prompts
 */

const Replicate = require('replicate');
const fs = require('fs').promises;
const path = require('path');
const { getApiConfig, validateCategory } = require('./apiConfig');

// ============================================
// REPLICATE CLIENT
// ============================================

let replicateClient = null;

const getReplicateClient = () => {
    if (!replicateClient) {
        if (!process.env.REPLICATE_API_TOKEN) {
            throw new Error('REPLICATE_API_TOKEN is not configured');
        }
        replicateClient = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
            useFileOutput: false
        });
    }
    return replicateClient;
};

// ============================================
// KATEGORİ BAZLI PROMPTLAR
// ============================================

const virtualTryOnPrompts = {
    upper_body: "Wear the upper body outfit in the second image as a virtual try-on on the upper body of the person in the first image.",
    lower_body: "Wear the lower body outfit in the second image as a virtual try-on on the lower body of the person in the first image.",
    dresses: "Wear the full outfit in the second image as a virtual try-on on the full body of the person in the first image."
};

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================

/**
 * Görsel dosyasını base64'e çevir
 */
const imageToBase64 = async (imagePath) => {
    try {
        console.log('📷 Reading image:', imagePath);
        const imageBuffer = await fs.readFile(imagePath);
        const base64 = imageBuffer.toString('base64');
        const mimeType = path.extname(imagePath).toLowerCase() === '.png' 
            ? 'image/png' 
            : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        console.log('✅ Base64 conversion successful');
        return dataUrl;
    } catch (error) {
        console.error('❌ Base64 conversion error:', error);
        throw new Error(`Base64 conversion error: ${error.message}`);
    }
};

/**
 * Nano Banana output'u işle
 */
const processNanoBananaOutput = (output) => {
    console.log('🔍 Processing Nano Banana output...');
    console.log('🔍 Output type:', typeof output);
    
    try {
        // Array kontrolü (Replicate genelde array döner)
        if (Array.isArray(output)) {
            if (output.length > 0) {
                const result = output[0];
                console.log('✅ Extracted URL from array:', result);
                return result;
            }
            throw new Error('Empty output array');
        }
        
        // Direct URL
        if (typeof output === 'string' && output.startsWith('http')) {
            console.log('✅ Direct URL detected:', output);
            return output;
        }
        
        // Object içinde URL arama
        if (typeof output === 'object' && output !== null) {
            const urlFields = ['url', 'image', 'output', 'result', 'images'];
            for (const field of urlFields) {
                if (output[field]) {
                    console.log(`✅ Found URL in field: ${field}`);
                    const value = output[field];
                    return Array.isArray(value) ? value[0] : value;
                }
            }
        }
        
        throw new Error('Could not extract URL from output');
        
    } catch (error) {
        console.error('❌ Output processing error:', error);
        throw error;
    }
};

// ============================================
// ANA SERVİS FONKSİYONU
// ============================================

/**
 * Nano Banana ile Virtual Try-On
 * @param {string} userImagePath - Kişi fotoğrafı (1. görsel)
 * @param {string} clothingImagePath - Kıyafet fotoğrafı (2. görsel)
 * @param {string} category - Kategori (upper_body, lower_body, dresses)
 * @returns {Promise<string>} İşlenmiş görsel URL'i
 */
const processWithNanoBanana = async (userImagePath, clothingImagePath, category) => {
    try {
        console.log('🌟 Nano Banana Processing started...');
        console.log(`👤 Person image (1st): ${userImagePath}`);
        console.log(`👕 Clothing image (2nd): ${clothingImagePath}`);
        console.log(`📂 Category: ${category}`);
        
        // Kategori validasyonu
        if (!validateCategory(category)) {
            throw new Error(`Invalid category: ${category}`);
        }
        
        // API config al
        const apiConfig = getApiConfig('nano-banana');
        if (!apiConfig.active) {
            throw new Error('Nano Banana API is not active');
        }
        
        // Kategori bazlı prompt al
        const prompt = virtualTryOnPrompts[category];
        if (!prompt) {
            throw new Error(`No prompt found for category: ${category}`);
        }
        
        console.log('📝 Category-specific prompt:', prompt);
        
        // Görselleri base64'e çevir
        const personImageBase64 = await imageToBase64(userImagePath);
        const clothingImageBase64 = await imageToBase64(clothingImagePath);
        
        console.log('📤 Calling Replicate Nano Banana API...');
        
        // Replicate client al
        const replicate = getReplicateClient();
        
        // Nano Banana API'sine gönder
        // image_input: Array olarak her iki görseli gönder
        // 1. görsel: Kişi
        // 2. görsel: Kıyafet
        // Prompt: Kategoriye özel
        const output = await replicate.run(
            "google/nano-banana",
            {
                input: {
                    prompt: prompt,
                    image_input: [
                        personImageBase64,      // 1. görsel (kişi)
                        clothingImageBase64     // 2. görsel (kıyafet)
                    ],
                    aspect_ratio: "match_input_image",
                    output_format: "jpg"
                }
            }
        );
        
        console.log('🔍 Raw Nano Banana output:', typeof output);
        
        // Output'u işle ve URL çıkar
        const resultUrl = processNanoBananaOutput(output);
        
        console.log('🎉 Nano Banana processing completed!');
        console.log('🔥 Result URL:', resultUrl);
        
        return resultUrl;
        
    } catch (error) {
        console.error('💥 Nano Banana processing error:', error);
        throw new Error(`Nano Banana processing failed: ${error.message}`);
    }
};

// ============================================
// API MANAGER İÇİN WRAPPER FONKSİYON
// ============================================

/**
 * ApiManager için standart interface
 * Bu fonksiyon apiManager.js tarafından çağrılır
 */
const processVirtualTryOn = async (userImagePath, clothingImagePath, category) => {
    return await processWithNanoBanana(userImagePath, clothingImagePath, category);
};

// ============================================
// SAĞLIK KONTROLÜ
// ============================================

/**
 * Nano Banana servisi sağlık kontrolü
 */
const healthCheck = async () => {
    try {
        const apiConfig = getApiConfig('nano-banana');
        const replicate = getReplicateClient();
        
        return {
            service: 'Nano Banana',
            status: apiConfig.active ? 'active' : 'inactive',
            model: apiConfig.model,
            type: apiConfig.type,
            replicateConnected: !!replicate,
            estimatedTime: `${apiConfig.estimatedTime}s`,
            costPerImage: `$${apiConfig.costPerImage}`,
            features: ['virtual-try-on']
        };
    } catch (error) {
        return {
            service: 'Nano Banana',
            status: 'error',
            error: error.message
        };
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    processWithNanoBanana,
    processVirtualTryOn,
    healthCheck,
    imageToBase64,
    processNanoBananaOutput
};