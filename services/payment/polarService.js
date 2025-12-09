const { Polar } = require('@polar-sh/sdk');

// Polar client initialization
const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN || 'polar_sandbox_token_placeholder',
  server: process.env.POLAR_SERVER || 'sandbox' // 'sandbox' or 'production'
});

/**
 * Checkout session oluştur
 * @param {string} userId - User ID
 * @param {string} userEmail - User email
 * @param {string} productId - Polar product ID
 * @param {object} metadata - Custom metadata
 * @returns {object} Checkout session
 */

async function createCheckoutSession(userId, userEmail, productId, metadata = {}) {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💳 CREATING POLAR CHECKOUT SESSION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('User ID:', userId);
    console.log('Email:', userEmail);
    console.log('Product ID:', productId);
    console.log('Metadata:', metadata);

    // ✅ FINAL FIX: products ARRAY kullan!
    const checkoutPayload = {
      // ✅ DÜZELTME: products array (plural!)
      products: [productId],  // ← ARRAY FORMAT!
      
      // Customer info
      customer_email: userEmail,
      
      // Success URL
      success_url: `${process.env.FRONTEND_URL}/payment/success?checkout_id={CHECKOUT_ID}`,
      
      // Metadata (webhook'da kullanacağız)
      metadata: {
        userId: userId,
        source: 'virtual-tryon',
        planName: metadata.planName || 'Unknown',
        planPrice: metadata.planPrice || '0',
        planCredits: metadata.planCredits || 0,
        planId: metadata.planId || 'unknown',
        timestamp: new Date().toISOString()
      }
    };

    console.log('📤 Sending to Polar:', JSON.stringify(checkoutPayload, null, 2));

    const checkout = await polar.checkouts.create(checkoutPayload);

    console.log('✅ Checkout session created');
    console.log('   Checkout ID:', checkout.id);
    console.log('   Checkout URL:', checkout.url);
    console.log('   Client Secret:', checkout.client_secret ? 'Present' : 'Missing');
    
    return {
      success: true,
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
      clientSecret: checkout.client_secret || null
    };
    
  } catch (error) {
    console.error('❌ Polar checkout creation error:', error);
    
    // Detailed error logging
    if (error.cause) {
      console.error('   Error cause:', error.cause);
    }
    if (error.rawValue) {
      console.error('   Raw value sent:', JSON.stringify(error.rawValue, null, 2));
    }
    
    return {
      success: false,
      error: error.rawMessage || error.message || 'Failed to create checkout session'
    };
  }
}

/**
 * Product bilgisini getir
 * @param {string} productId - Polar product ID
 * @returns {object} Product info
 */
async function getProductInfo(productId) {
  try {
    console.log('📦 Fetching product info:', productId);
    
    const product = await polar.products.get({ id: productId });
    
    console.log('✅ Product found:', product.name);
    
    return {
      success: true,
      product: product
    };
  } catch (error) {
    console.error('❌ Get product error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Order bilgisini getir
 * @param {string} orderId - Polar order ID
 * @returns {object} Order info
 */
async function getOrder(orderId) {
  try {
    console.log('📦 Fetching order info:', orderId);
    
    const order = await polar.orders.get({ id: orderId });
    
    console.log('✅ Order found:', order.id);
    
    return {
      success: true,
      order: order
    };
  } catch (error) {
    console.error('❌ Get order error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Checkout bilgisini getir
 * @param {string} checkoutId - Polar checkout ID
 * @returns {object} Checkout info
 */
async function getCheckout(checkoutId) {
  try {
    console.log('🛒 Fetching checkout info:', checkoutId);
    
    const checkout = await polar.checkouts.get({ id: checkoutId });
    
    console.log('✅ Checkout found:', checkout.id);
    
    return {
      success: true,
      checkout: checkout
    };
  } catch (error) {
    console.error('❌ Get checkout error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  polar,
  createCheckoutSession,
  getProductInfo,
  getOrder,
  getCheckout
};