const { supabase, supabaseAdmin } = require('../../config/supabase');

/**
 * Email/Password ile kullanıcı kaydet
 */
async function registerWithEmail(email, password, deviceId) {
  try {
    // 1. Supabase Auth'da kullanıcı oluştur (PUBLIC client kullan)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          device_id: deviceId
        }
      }
    });

    if (authError) throw authError;

    // 2. Users tablosunda kayıt oluştur (ADMIN client kullan)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id, // Supabase auth ID'yi kullan
        email: email,
        is_anonymous: false,
        auth_provider: 'email',
        auth_user_id: authData.user.id,
        free_trials_limit: 1,
        free_trials_used: 0,
        credits: 0,
        signup_source: 'web',
        last_login_at: new Date().toISOString()
      })
      .select()
      .single();

    if (userError) throw userError;

    // 3. Device mapping oluştur (ADMIN client)
    if (deviceId) {
      await supabaseAdmin
        .from('user_devices')
        .insert({
          user_id: user.id,
          device_id: deviceId
        });
    }

    return {
      success: true,
      user,
      session: authData.session
    };

  } catch (error) {
    console.error('Register error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function loginWithEmail(email, password) {
  try {
    // 1. Supabase Auth ile giriş (PUBLIC client)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) throw authError;

    console.log(`✅ Auth login successful: ${authData.user.id}`);

    // 2. Users tablosundan user bilgilerini al (ID ile)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    // User bulundu, normal flow
    if (user && !userError) {
      console.log('✅ User found, updating last login...');
      
      await supabaseAdmin
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);

      return {
        success: true,
        user,
        session: authData.session
      };
    }

    // ✅ AUTO-FIX: User yoksa
    console.log('⚠️ User not found by ID, checking by email...');
    
    // Email ile kontrol et
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      // Email ile eski user var, temizle ve yeniden oluştur
      console.log('⚠️ Found old user with same email, migrating...');
      console.log(`   Old ID: ${existingUser.id} → New ID: ${authData.user.id}`);
      
      // Eski user'ın credits'ini kaydet
      const oldCredits = existingUser.credits || 0;
      const oldTrialsUsed = existingUser.free_trials_used || 0;
      
      // Eski user'ı sil
      await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', existingUser.id);
      
      console.log('   Old user deleted');
      
      // Yeni user oluştur (eski credits'le)
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          email: email,
          is_anonymous: false,
          auth_provider: 'email',
          auth_user_id: authData.user.id,
          free_trials_limit: 1,
          free_trials_used: oldTrialsUsed, // ← Eski değer
          credits: oldCredits, // ← Eski değer
          signup_source: 'web',
          last_login_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('❌ Insert failed:', insertError);
        throw insertError;
      }

      console.log('✅ User migrated successfully');

      return {
        success: true,
        user: newUser,
        session: authData.session
      };
      
    } else {
      // Email ile de yok, tamamen yeni user
      console.log('✅ Creating new user...');
      
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          email: email,
          is_anonymous: false,
          auth_provider: 'email',
          auth_user_id: authData.user.id,
          free_trials_limit: 1,
          free_trials_used: 0,
          credits: 0,
          signup_source: 'web',
          last_login_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('❌ Insert failed:', insertError);
        throw insertError;
      }

      console.log('✅ User created successfully');

      return {
        success: true,
        user: newUser,
        session: authData.session
      };
    }

  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Anonymous user'ı registered user'a dönüştür
 */
async function migrateAnonymousToAuth(anonymousUserId, email, password) {
  try {
    // 1. Anonymous user'ı getir (ADMIN client)
    const { data: anonymousUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', anonymousUserId)
      .eq('is_anonymous', true)
      .single();

    if (!anonymousUser) {
      throw new Error('Anonymous user not found');
    }

    // 2. Supabase Auth'da user oluştur (PUBLIC client)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password
    });

    if (authError) throw authError;

    // 3. Anonymous user'ı güncelle (ADMIN client)
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        email: email,
        is_anonymous: false,
        auth_provider: 'email',
        auth_user_id: authData.user.id,
        last_login_at: new Date().toISOString()
      })
      .eq('id', anonymousUserId)
      .select()
      .single();

    if (updateError) throw updateError;

    // 4. Credits ve generation history korunuyor (değişmedi)
    
    return {
      success: true,
      user: updatedUser,
      session: authData.session,
      message: 'Migration successful'
    };

  } catch (error) {
    console.error('Migration error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Google OAuth ile giriş (hazırlık)
 */
async function loginWithGoogle() {
  try {
    // PUBLIC client kullan
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.FRONTEND_URL}/auth/callback`
      }
    });

    if (error) throw error;

    return {
      success: true,
      url: data.url
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Password reset email gönder
 */
async function sendPasswordReset(email) {
  try {
    // PUBLIC client kullan
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });

    if (error) throw error;

    return {
      success: true,
      message: 'Password reset email sent'
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Password'ü güncelle
 */
async function updatePassword(newPassword) {
  try {
    // PUBLIC client kullan
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    return {
      success: true,
      message: 'Password updated'
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  registerWithEmail,
  loginWithEmail,
  migrateAnonymousToAuth,
  loginWithGoogle,
  sendPasswordReset,
  updatePassword
};