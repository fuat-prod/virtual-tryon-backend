/**
 * IDM-VTON Service
 * Virtual Try-On işlemleri için servis katmanı
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
// YARDIMCI FONKSİYONLAR
// ============================================

/**
 * Görsel dosyasını base64'e çevir
 */
const imageToBase64 = async (imagePath) => {
    try {
        console.log('📷 Reading image:', imagePath);
        const imageBuffer = await fs.readFile(imagePath);
        console.log('📊 Buffer size:', imageBuffer.length);
        
        const base64 = imageBuffer.toString('base64');
        const mimeType = path.extname(imagePath).toLowerCase() === '.png' 
            ? 'image/png' 
            : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        console.log('✅ Base64 conversion successful, size:', dataUrl.length);
        return dataUrl;
    } catch (error) {
        console.error('❌ Base64 conversion error:', error);
        throw new Error(`Base64 conversion error: ${error.message}`);
    }
};

/**
 * ReadableStream'i işle ve URL çıkar
 */
const processReplicateOutput = async (output) => {
    console.log('🔍 Processing Replicate output...');
    console.log('🔍 Output type:', typeof output);
    console.log('🔍 Output constructor:', output?.constructor?.name);

    try {
        // ReadableStream kontrolü
        if (output && typeof output === 'object' && output.constructor.name === 'ReadableStream') {
            console.log('📖 ReadableStream detected, converting to URL...');
            
            const chunks = [];
            const reader = output.getReader();
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            
            // Chunks'ı birleştir
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const uint8Array = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                uint8Array.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Text'e çevir
            const textDecoder = new TextDecoder();
            const responseText = textDecoder.decode(uint8Array);
            
            console.log('🔍 Stream converted to text, length:', responseText.length);
            
            // JSON parse dene
            try {
                const jsonResponse = JSON.parse(responseText);
                const resultUrl = Array.isArray(jsonResponse) ? jsonResponse[0] : jsonResponse;
                console.log('✅ Extracted URL from JSON:', resultUrl);
                return resultUrl;
            } catch {
                // JSON değilse direkt text
                const resultUrl = responseText.trim();
                console.log('✅ Using text as URL:', resultUrl);
                return resultUrl;
            }
        }
        
        // Array kontrolü
        if (Array.isArray(output) && output.length > 0) {
            console.log('📋 Array detected, using first element');
            return output[0];
        }
        
        // Direct string/URL
        if (typeof output === 'string') {
            console.log('🔗 Direct string/URL detected');
            return output;
        }
        
        // Object kontrolü
        if (typeof output === 'object' && output !== null) {
            console.log('📦 Object detected, trying to extract URL');
            // Olası URL field'ları
            const urlFields = ['url', 'image', 'output', 'result'];
            for (const field of urlFields) {
                if (output[field]) {
                    console.log(`✅ Found URL in field: ${field}`);
                    return output[field];
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
 * IDM-VTON ile Virtual Try-On işlemi
 * @param {string} userImagePath - Kullanıcı fotoğrafı path
 * @param {string} clothingImagePath - Kıyafet fotoğrafı path
 * @param {string} category - Kategori (upper_body, lower_body, dresses)
 * @returns {Promise<string>} İşlenmiş görsel URL'i
 */
const processWithIdmVton = async (userImagePath, clothingImagePath, category) => {
    try {
        console.log('🎯 IDM-VTON Processing started...');
        console.log(`👤 User image: ${userImagePath}`);
        console.log(`👕 Clothing image: ${clothingImagePath}`);
        console.log(`📂 Category: ${category}`);
        
        // Kategori validasyonu
        if (!validateCategory(category)) {
            throw new Error(`Invalid category: ${category}`);
        }
        
        // API config al
        const apiConfig = getApiConfig('idm-vton');
        if (!apiConfig.active) {
            throw new Error('IDM-VTON API is not active');
        }
        
        // Görselleri base64'e çevir
        const humanImage = await imageToBase64(userImagePath);
        const garmImage = await imageToBase64(clothingImagePath);
        
        console.log('📤 Calling Replicate API...');
        
        // Replicate client al
        const replicate = getReplicateClient();
        
        // IDM-VTON modeli ile işle
        const output = await replicate.run(
            apiConfig.model,
            {
                input: {
                    human_img: humanImage,
                    garm_img: garmImage,
                    category: category,
                    garment_des: `${category.replace('_', ' ')} clothing item`,
                    crop: false,
                    seed: Math.floor(Math.random() * 1000000),
                    steps: 30,
                    mask_only: false,
                    force_dc: false
                }
            }
        );
        
        console.log('🔍 Raw Replicate output type:', typeof output);
        
        // Output'u işle ve URL çıkar
        const resultUrl = await processReplicateOutput(output);
        
        console.log('🎉 IDM-VTON processing completed!');
        console.log('🔥 Result URL:', resultUrl);
        
        return resultUrl;
        
    } catch (error) {
        console.error('💥 IDM-VTON processing error:', error);
        throw new Error(`IDM-VTON processing failed: ${error.message}`);
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
    return await processWithIdmVton(userImagePath, clothingImagePath, category);
};

// ============================================
// SAĞLIK KONTROLÜ
// ============================================

/**
 * IDM-VTON servisi sağlık kontrolü
 */
const healthCheck = async () => {
    try {
        const apiConfig = getApiConfig('idm-vton');
        const replicate = getReplicateClient();
        
        return {
            service: 'IDM-VTON',
            status: apiConfig.active ? 'active' : 'inactive',
            model: apiConfig.model,
            replicateConnected: !!replicate,
            estimatedTime: `${apiConfig.estimatedTime}s`,
            costPerImage: `$${apiConfig.costPerImage}`
        };
    } catch (error) {
        return {
            service: 'IDM-VTON',
            status: 'error',
            error: error.message
        };
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    processWithIdmVton,
    processVirtualTryOn,  // ← ApiManager için
    healthCheck,
    imageToBase64,
    processReplicateOutput
};