const { supabaseAdmin } = require('../../config/supabase');
const { v4: uuidv4 } = require('uuid');

/**
 * Anonymous User Oluştur veya Mevcut Kullanıcıyı Getir
 */
async function createOrGetAnonymousUser(deviceId, deviceInfo = {}) {
  try {
    // 1. Device fingerprint kontrol et
    const { data: existingDevice } = await supabaseAdmin
      .from('device_fingerprints')
      .select('device_id, abuse_flag, total_free_trials_used')
      .eq('device_id', deviceId)
      .single();

    // 2. Device zaten varsa ve abuse flag varsa engelle
    if (existingDevice?.abuse_flag) {
      return {
        success: false,
        error: 'Device flagged for abuse',
        code: 'DEVICE_BLOCKED'
      };
    }

    // 3. Device'a bağlı kullanıcıyı bul
    if (existingDevice) {
      const { data: userDevice } = await supabaseAdmin
        .from('user_devices')
        .select('user_id')
        .eq('device_id', deviceId)
        .order('last_seen', { ascending: false })
        .limit(1)
        .single();

      if (userDevice) {
        // Mevcut kullanıcıyı getir
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('id', userDevice.user_id)
          .single();

        // Last seen güncelle
        await supabaseAdmin
          .from('user_devices')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('device_id', deviceId);

        return {
          success: true,
          user,
          isNew: false
        };
      }
    }

    // 4. Yeni anonim kullanıcı oluştur
    const { data: newUser, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        is_anonymous: true,
        auth_provider: 'anonymous',
        free_trials_limit: 1,
        free_trials_used: 0,
        credits: 0,
        device_type: deviceInfo.device_type || 'unknown',
        country: deviceInfo.country || null,
        signup_source: deviceInfo.source || 'web',
        last_login_at: new Date().toISOString()
      })
      .select()
      .single();

    if (userError) throw userError;

    // 5. Device fingerprint kaydet veya güncelle
    if (existingDevice) {
      await supabaseAdmin
        .from('device_fingerprints')
        .update({
          anonymous_accounts_created: existingDevice.anonymous_accounts_created + 1,
          last_seen: new Date().toISOString(),
          ...deviceInfo
        })
        .eq('device_id', deviceId);
    } else {
      await supabaseAdmin
        .from('device_fingerprints')
        .insert({
          device_id: deviceId,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          screen_resolution: deviceInfo.screen_resolution,
          timezone: deviceInfo.timezone,
          language: deviceInfo.language,
          anonymous_accounts_created: 1
        });
    }

    // 6. User-Device mapping oluştur
    await supabaseAdmin
      .from('user_devices')
      .insert({
        user_id: newUser.id,
        device_id: deviceId
      });

    return {
      success: true,
      user: newUser,
      isNew: true
    };

  } catch (error) {
    console.error('Create anonymous user error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Kullanıcı Bilgilerini Getir
 */
async function getUserById(userId) {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;

    return {
      success: true,
      user
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Kullanıcı Credits Güncelle
 */
async function updateUserCredits(userId, amount, reason) {
  try {
    // Mevcut kullanıcıyı al
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    const newBalance = user.credits + amount;

    // Credits güncelle
    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update({ 
        credits: newBalance,
        last_generation_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Credit history kaydet
    await supabaseAdmin
      .from('credit_history')
      .insert({
        user_id: userId,
        amount: amount,
        balance_before: user.credits,
        balance_after: newBalance,
        reason: reason
      });

    return {
      success: true,
      user: updatedUser
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  createOrGetAnonymousUser,
  getUserById,
  updateUserCredits
};