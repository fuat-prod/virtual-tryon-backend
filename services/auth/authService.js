const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../../config/supabase');

// ... (diğer fonksiyonlar aynı kalıyor)

/**
 * ✅ YENİ: Save account with OPTIONAL password
 * Password varsa → Supabase auth oluştur
 * Password yoksa → Passwordless, sadece email kayıtlı
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

module.exports = {
  registerWithEmail,
  loginWithEmail,
  migrateAnonymousToAuth,
  loginWithGoogle,
  sendPasswordReset,
  updatePassword,
  saveAccount
};