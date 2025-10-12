// services/apiManager.js
const { apiConfig } = require('./apiConfig');
const idmVtonService = require('./idmVtonService');
const nanoBananaService = require('./nanoBananaService');

class ApiManager {
    constructor() {
        this.apis = {
            'idm-vton': idmVtonService,
            'nano-banana': nanoBananaService
        };
    }

    /**
     * Aktif API'leri al
     */
    getActiveApis() {
        return Object.keys(this.apis).filter(key => {
            const config = apiConfig[key];
            return config && config.enabled && config.active;
        });
    }

    /**
     * Kategori için en uygun API'yi seç
     * @param {string} category - upper_body, lower_body, dresses
     */
    selectBestApi(category) {
        const activeApis = this.getActiveApis();
        
        console.log('🔍 Active APIs:', activeApis);
        
        if (activeApis.length === 0) {
            throw new Error('No active API available');
        }

        // Kategori bazlı öncelik sistemi
        const apiPriority = {
            upper_body: ['idm-vton', 'nano-banana'],
            lower_body: ['idm-vton', 'nano-banana'],
            dresses: ['nano-banana', 'idm-vton']
        };

        const priorityList = apiPriority[category] || apiPriority.upper_body;
        
        // Öncelik listesinden ilk aktif API'yi seç
        for (const apiName of priorityList) {
            if (activeApis.includes(apiName)) {
                console.log(`✅ Selected API for ${category}: ${apiName}`);
                return apiName;
            }
        }

        // Fallback: İlk aktif API
        console.log(`⚠️ Using fallback API: ${activeApis[0]}`);
        return activeApis[0];
    }

    /**
     * Seçilen API ile try-on işlemi yap
     */
    async processWithApi(apiName, userImagePath, clothingImagePath, category) {
        console.log(`🎯 Processing with ${apiName}...`);
        
        if (!this.apis[apiName]) {
            throw new Error(`API not found: ${apiName}`);
        }

        const config = apiConfig[apiName];
        if (!config || !config.enabled) {
            throw new Error(`API not enabled: ${apiName}`);
        }

        const api = this.apis[apiName];
        return await api.processVirtualTryOn(userImagePath, clothingImagePath, category);
    }

    /**
     * Otomatik API seçimi ve işleme
     */
    async autoProcess(userImagePath, clothingImagePath, category) {
        const selectedApi = this.selectBestApi(category);
        
        try {
            const result = await this.processWithApi(
                selectedApi, 
                userImagePath, 
                clothingImagePath, 
                category
            );
            
            return {
                success: true,
                usedApi: selectedApi,
                result: result
            };
            
        } catch (error) {
            console.error(`❌ ${selectedApi} failed:`, error.message);
            
            // Fallback: Diğer aktif API'leri dene
            const activeApis = this.getActiveApis().filter(api => api !== selectedApi);
            
            for (const fallbackApi of activeApis) {
                console.log(`🔄 Trying fallback API: ${fallbackApi}`);
                try {
                    const result = await this.processWithApi(
                        fallbackApi,
                        userImagePath,
                        clothingImagePath,
                        category
                    );
                    
                    return {
                        success: true,
                        usedApi: fallbackApi,
                        result: result,
                        fallback: true
                    };
                    
                } catch (fallbackError) {
                    console.error(`❌ ${fallbackApi} also failed:`, fallbackError.message);
                }
            }
            
            throw new Error('All APIs failed to process the image');
        }
    }

    /**
     * API sağlık kontrolü
     */
    async healthCheck() {
        const results = {};
        
        for (const [apiName, api] of Object.entries(this.apis)) {
            const config = apiConfig[apiName];
            
            if (!config || !config.enabled) {
                results[apiName] = {
                    status: 'disabled',
                    message: 'API is disabled in config'
                };
                continue;
            }

            try {
                // Her API'nin kendi health check metodunu çağır
                if (api.healthCheck) {
                    const health = await api.healthCheck();
                    results[apiName] = health;
                } else {
                    results[apiName] = {
                        status: 'healthy',
                        message: 'API is operational (no health check method)'
                    };
                }
                
            } catch (error) {
                results[apiName] = {
                    status: 'unhealthy',
                    message: error.message
                };
            }
        }
        
        return results;
    }

    /**
     * Belirli bir API ile manuel işlem
     * Frontend'den API seçimi yapılırsa kullanılır
     */
    async processWithSpecificApi(apiName, userImagePath, clothingImagePath, category) {
        console.log(`🎯 Manual API selection: ${apiName}`);
        
        const config = apiConfig[apiName];
        if (!config || !config.enabled) {
            throw new Error(`API ${apiName} is not enabled`);
        }
        
        return await this.processWithApi(apiName, userImagePath, clothingImagePath, category);
    }
}

// Singleton instance
const apiManager = new ApiManager();

module.exports = apiManager;