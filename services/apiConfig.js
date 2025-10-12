// services/apiConfig.js
require('dotenv').config();

/**
 * Multi-API Configuration
 * Her API için konfigürasyon ve prompt templateları
 */

const apiConfig = {
    // IDM-VTON (Mevcut API)
    'idm-vton': {
        enabled: false,
        active: false,
        apiKey: process.env.REPLICATE_API_TOKEN,
        model: "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
        timeout: 120000,
        estimatedTime: 60,
        costPerImage: 0.01,
        priority: {
            upper_body: 2,
            lower_body: 2,
            dresses: 2
        }
    },

    // Google Nano Banana (Yeni API)
    'nano-banana': {
        enabled: true,
        active: true,
        apiKey: process.env.REPLICATE_API_TOKEN,
        model: "google/nano-banana",
        type: 'prompt-based',
        timeout: 120000,
        estimatedTime: 45,
        costPerImage: 0.005,
        features: ['text-to-image', 'image-editing'],
        priority: {
            upper_body: 1,
            lower_body: 1,
            dresses: 1
        }
    }
};

/**
 * Kategori bazlı prompt templates
 */
const promptTemplates = {
    upper_body: {
        prompt: "Wear the upper body outfit in the second image as a virtual try-on on the upper body of the person in the first image.",
        negative_prompt: "blurry, low quality, distorted, unrealistic, cartoon"
    },
    
    lower_body: {
        prompt: "Wear the lower body outfit in the second image as a virtual try-on on the lower body of the person in the first image.",
        negative_prompt: "blurry, low quality, distorted, unrealistic, cartoon, cropped"
    },
    
    dresses: {
        prompt: "Wear the full outfit in the second image as a virtual try-on on the full body of the person in the first image.",
        negative_prompt: "blurry, low quality, distorted, unrealistic, cartoon, poorly fitted"
    },
    
    default: {
        prompt: "A person wearing clothing, professional fashion photography, high quality",
        negative_prompt: "blurry, low quality, distorted, unrealistic"
    }
};

/**
 * API seçim stratejisi
 */
const apiSelectionStrategy = {
    priority: 'category-based',
    fallback: true,
    maxRetries: 2,
    timeout: 120000
};

/**
 * Valid kategoriler
 */
const validCategories = ['upper_body', 'lower_body', 'dresses'];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Kategori validasyonu
 * @param {string} category - Kontrol edilecek kategori
 * @returns {boolean} Geçerli mi?
 */
const validateCategory = (category) => {
    return validCategories.includes(category);
};

/**
 * API config'i al
 * @param {string} apiName - API adı ('idm-vton' veya 'nano-banana')
 * @returns {object} API konfigürasyonu
 */
const getApiConfig = (apiName) => {
    const config = apiConfig[apiName];
    
    if (!config) {
        throw new Error(`API configuration not found: ${apiName}`);
    }
    
    return config;
};

/**
 * Kategori ve stil için prompt oluştur
 * @param {string} category - Kategori
 * @param {string} style - Stil (optional)
 * @returns {object} { prompt, negative_prompt }
 */
const generatePrompt = (category, style = 'default') => {
    const template = promptTemplates[category] || promptTemplates.default;
    
    // Stil bazlı özelleştirmeler eklenebilir
    const styleModifiers = {
        casual: ' in casual style',
        formal: ' in formal style',
        sporty: ' in sporty style',
        elegant: ' in elegant style'
    };
    
    const modifier = styleModifiers[style] || '';
    
    return {
        prompt: template.prompt + modifier,
        negative_prompt: template.negative_prompt
    };
};

/**
 * Aktif API'leri listele
 * @returns {array} Aktif API isimleri
 */
const getActiveApis = () => {
    return Object.keys(apiConfig).filter(key => apiConfig[key].enabled);
};

/**
 * Belirli kategori için en iyi API'yi seç
 * @param {string} category - Kategori
 * @returns {string} API adı
 */
const selectBestApiForCategory = (category) => {
    const activeApis = getActiveApis();
    
    if (activeApis.length === 0) {
        throw new Error('No active APIs available');
    }
    
    // Priority'ye göre sırala
    const sortedApis = activeApis.sort((a, b) => {
        const priorityA = apiConfig[a].priority[category] || 999;
        const priorityB = apiConfig[b].priority[category] || 999;
        return priorityA - priorityB;
    });
    
    return sortedApis[0];
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
    apiConfig,
    promptTemplates,
    apiSelectionStrategy,
    validCategories,
    // Functions
    validateCategory,
    getApiConfig,
    generatePrompt,
    getActiveApis,
    selectBestApiForCategory
};