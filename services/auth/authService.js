const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../../config/supabase');

/**
 * Email/Password ile kullanıcı kaydet
 */
async function registerWithEmail(email, password, deviceId) {
  try {
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

    const { data: user, error: userError } = await supabaseAdmin
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

    if (userError) throw userError;

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

/**
 * Email/Password ile giriş yap
 */
async function loginWithEmail(email, password) {
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) throw authError;

    console.log(`✅ Auth login successful: ${authData.user.id}`);

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

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

    console.log('⚠️ User not found by ID, checking by email...');
    
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      console.log('⚠️ Found old user with same email, migrating...');
      console.log(`   Old ID: ${existingUser.id} → New ID: ${authData.user.id}`);
      
      const oldCredits = existingUser.credits || 0;
      const oldTrialsUsed = existingUser.free_trials_used || 0;
      
      await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', existingUser.id);
      
      console.log('   Old user deleted');
      
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          email: email,
          is_anonymous: false,
          auth_provider: 'email',
          auth_user_id: authData.user.id,
          free_trials_limit: 1,
          free_trials_used: oldTrialsUsed,
          credits: oldCredits,
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
    const { data: anonymousUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', anonymousUserId)
      .eq('is_anonymous', true)
      .single();

    if (!anonymousUser) {
      throw new Error('Anonymous user not found');
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password
    });

    if (authError) throw authError;

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
 * ✅ YENİ: Save account with OPTIONAL password
 */
async function saveAccount(anonymousUserId, email, password = null) {
  try {
    console.log('💾 Save account started');
    console.log('   User ID:', anonymousUserId);
    console.log('   Email:', email);
    console.log('   Password:', password ? 'Provided' : 'Not provided (passwordless)');

    // 1. Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // 2. Anonymous user kontrol
    const { data: anonymousUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', anonymousUserId)
      .eq('is_anonymous', true)
      .single();

    if (userError || !anonymousUser) {
      throw new Error('Anonymous user not found');
    }

    console.log('✅ Anonymous user found');
    console.log('   Current credits:', anonymousUser.credits);

    // 3. Email zaten kullanılıyor mu?
    const { data: existingAuthUsers } = await supabase.auth.admin.listUsers();
    const emailExists = existingAuthUsers?.users?.some(u => u.email === email);

    if (emailExists) {
      throw new Error('Email already registered. Please login instead.');
    }

    console.log('✅ Email available');

    let authUserId = null;
    let session = null;

    // 4. ✅ PASSWORD VARSA → Supabase auth oluştur
    if (password) {
      console.log('🔐 Creating auth user with password...');
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            from_soft_prompt: true,
            has_password: true
          },
          emailRedirectTo: `${process.env.FRONTEND_URL || 'https://www.dressai.app'}`
        }
      });

      if (authError) {
        console.error('❌ Auth user creation failed:', authError.message);
        throw authError;
      }

      authUserId = authData.user.id;
      session = authData.session;
      
      console.log('✅ Auth user created:', authUserId);
      console.log('✅ User can now login with email + password');
    } else {
      console.log('🔓 Passwordless mode - no auth user created');
      console.log('   User can set password later from profile');
    }

    // 5. Users tablosunu güncelle
    const updateData = {
      email: email,
      is_anonymous: false,
      last_login_at: new Date().toISOString()
    };

    // Password varsa auth bilgilerini ekle
    if (authUserId) {
      updateData.auth_user_id = authUserId;
      updateData.auth_provider = 'email';
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', anonymousUserId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('✅ User updated');
    console.log('   Email:', updatedUser.email);
    console.log('   Auth User ID:', updatedUser.auth_user_id || 'None (passwordless)');
    console.log('   Credits preserved:', updatedUser.credits);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ACCOUNT SAVED SUCCESSFULLY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return {
      success: true,
      user: updatedUser,
      session: session,
      hasPassword: !!password,
      message: password 
        ? 'Account created with password' 
        : 'Email saved - you can set password later'
    };

  } catch (error) {
    console.error('Save account error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Google OAuth ile giriş
 */
async function loginWithGoogle() {
  try {
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
  updatePassword,
  saveAccount
};