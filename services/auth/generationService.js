const { supabaseAdmin } = require('../../config/supabase');

/**
 * Yeni generation kaydı oluştur
 */
async function createGeneration(userId, generationData) {
  try {
    const { data, error } = await supabaseAdmin
      .from('generations')
      .insert({
        user_id: userId,
        category: generationData.category,
        api_used: generationData.api_used || 'nano-banana',
        person_image_url: generationData.person_image_url,
        garment_image_url: generationData.garment_image_url,
        result_image_url: generationData.result_image_url,
        status: 'completed',
        credits_used: generationData.credits_used || 0,
        was_free_trial: generationData.was_free_trial || false,
        processing_time_seconds: generationData.processing_time_seconds,
        completed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // ✅ User'ın total_generations sayısını artır (DÜZELTİLDİ)
    const { data: currentUser } = await supabaseAdmin
      .from('users')
      .select('total_generations')
      .eq('id', userId)
      .single();

    await supabaseAdmin
      .from('users')
      .update({ 
        total_generations: (currentUser?.total_generations || 0) + 1,
        last_generation_at: new Date().toISOString()
      })
      .eq('id', userId);

    return {
      success: true,
      generation: data
    };
  } catch (error) {
    console.error('Create generation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * User generation geçmişini getir
 */
async function getUserGenerations(userId, limit = 10) {
  try {
    const { data, error } = await supabaseAdmin
      .from('generations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return {
      success: true,
      generations: data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Free trial kullan ve generation oluştur
 */
async function useFreeTrial(userId, generationData) {
  try {
    // User bilgilerini al
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('free_trials_used, free_trials_limit')
      .eq('id', userId)
      .single();

    if (!user) {
      throw new Error('User not found');
    }

    if (user.free_trials_used >= user.free_trials_limit) {
      return {
        success: false,
        error: 'No free trials remaining',
        code: 'NO_FREE_TRIALS'
      };
    }

    // Free trial sayısını artır
    await supabaseAdmin
      .from('users')
      .update({ 
        free_trials_used: user.free_trials_used + 1
      })
      .eq('id', userId);

    // Generation kaydı oluştur
    const result = await createGeneration(userId, {
      ...generationData,
      credits_used: 0,
      was_free_trial: true
    });

    return result;

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Credits ile generation oluştur
 */
async function useCredits(userId, generationData, creditsToUse = 1) {
  try {
    // User bilgilerini al
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    if (!user) {
      throw new Error('User not found');
    }

    if (user.credits < creditsToUse) {
      return {
        success: false,
        error: 'Insufficient credits',
        code: 'INSUFFICIENT_CREDITS'
      };
    }

    // Credits düş
    const newBalance = user.credits - creditsToUse;
    await supabaseAdmin
      .from('users')
      .update({ credits: newBalance })
      .eq('id', userId);

    // Credit history kaydet
    await supabaseAdmin
      .from('credit_history')
      .insert({
        user_id: userId,
        amount: -creditsToUse,
        balance_before: user.credits,
        balance_after: newBalance,
        reason: 'generation_used'
      });

    // Generation kaydı oluştur
    const result = await createGeneration(userId, {
      ...generationData,
      credits_used: creditsToUse,
      was_free_trial: false
    });

    return {
      ...result,
      credits_remaining: newBalance
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  createGeneration,
  getUserGenerations,
  useFreeTrial,
  useCredits
};