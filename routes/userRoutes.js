const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');

/**
 * GET /api/user/credit-history/:userId
 * User'ın credit history'sini getir
 */
router.get('/credit-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log('📊 Fetching credit history for user:', userId);

    // Credit history getir (son 50 işlem)
    const { data: history, error } = await supabaseAdmin
      .from('credit_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('❌ Credit history error:', error);
      throw error;
    }

    console.log('✅ Credit history fetched:', history.length, 'transactions');

    res.json({
      success: true,
      history: history || []
    });

  } catch (error) {
    console.error('❌ Credit history error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/user/stats/:userId
 * User istatistikleri
 */
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log('📊 Fetching stats for user:', userId);

    // User bilgisi
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Total credits earned
    const { data: earnedCredits } = await supabaseAdmin
      .from('credit_history')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'purchase');

    const totalEarned = earnedCredits?.reduce((sum, record) => sum + record.amount, 0) || 0;

    // Total credits spent
    const { data: spentCredits } = await supabaseAdmin
      .from('credit_history')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'usage');

    const totalSpent = Math.abs(spentCredits?.reduce((sum, record) => sum + Math.abs(record.amount), 0) || 0);

    // Total generations
    const { count: totalGenerations } = await supabaseAdmin
      .from('credit_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'usage');

    res.json({
      success: true,
      stats: {
        currentCredits: user.credits,
        totalEarned,
        totalSpent,
        totalGenerations: totalGenerations || 0,
        accountCreated: user.created_at,
        lastPayment: user.last_payment_at,
        isAnonymous: user.is_anonymous
      }
    });

  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;