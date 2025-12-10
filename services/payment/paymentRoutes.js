const express = require('express');
const router = express.Router();
const { createCheckoutSession, getProductInfo } = require('./polarService');
const { supabaseAdmin } = require('../../config/supabase');

/**
 * POST /api/payment/create-checkout
 * Checkout session oluştur
 */
router.post('/create-checkout', async (req, res) => {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 CREATE CHECKOUT REQUEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const { userId, productId, planDetails } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'productId is required'
      });
    }

    console.log('User ID:', userId);
    console.log('Product ID:', productId);
    console.log('Plan Details:', planDetails);

    // User bilgisini getir
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, is_anonymous')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('✅ User found:', user.email || 'anonymous');
    console.log('   Is Anonymous:', user.is_anonymous);

    // ✅ DÜZELTME: Anonymous user check kaldırıldı
    // Anonymous users can make payments
    // They will provide email in Polar checkout form
    
    // ✅ Email optional (anonymous users için null olabilir)
    const userEmail = user.email || null;
    
    if (!userEmail && !user.is_anonymous) {
      // Registered user'ın email'i olmalı
      console.error('❌ Registered user has no email');
      return res.status(400).json({
        success: false,
        error: 'User email not found'
      });
    }

    // Checkout oluştur
    console.log('🔄 Creating checkout...');
    console.log('   User Email:', userEmail || 'Will be collected by Polar');
    
    const result = await createCheckoutSession(
      userId,
      userEmail, // null olabilir (anonymous için)
      productId,
      {
        // Plan details metadata olarak gönder
        planName: planDetails?.name || 'Unknown Plan',
        planPrice: planDetails?.price || '0',
        planCredits: planDetails?.credits || 0,
        planId: planDetails?.id || 'unknown',
        isAnonymous: user.is_anonymous // ✅ Webhook için ekle
      }
    );

    if (!result.success) {
      console.error('❌ Checkout creation failed:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    console.log('✅ Checkout session created successfully');
    console.log('   Checkout URL:', result.checkoutUrl);

    res.json({
      success: true,
      checkoutId: result.checkoutId,
      checkoutUrl: result.checkoutUrl,
      clientSecret: result.clientSecret
    });

  } catch (error) {
    console.error('❌ Create checkout error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * GET /api/payment/product/:productId
 * Product bilgisi getir
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    console.log('📦 Fetching product:', productId);

    const result = await getProductInfo(productId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      product: result.product
    });

  } catch (error) {
    console.error('❌ Get product error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/payment/health
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Payment service is running',
    polar: {
      configured: !!process.env.POLAR_ACCESS_TOKEN,
      server: process.env.POLAR_SERVER || 'sandbox'
    }
  });
});

module.exports = router;