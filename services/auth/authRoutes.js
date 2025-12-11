const express = require('express');
const router = express.Router();
const { createOrGetAnonymousUser, getUserById } = require('./userService');
const { 
  registerWithEmail, 
  loginWithEmail, 
  migrateAnonymousToAuth,
  loginWithGoogle,
  sendPasswordReset,
  updatePassword,
  saveAccount // ✅ YENİ
} = require('./authService');

/**
 * POST /api/auth/anonymous
 * Anonim kullanıcı oluştur veya mevcut kullanıcıyı getir
 */
router.post('/anonymous', async (req, res) => {
  try {
    const { deviceId, deviceInfo } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      });
    }

    const result = await createOrGetAnonymousUser(deviceId, deviceInfo);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      user: result.user,
      isNew: result.isNew,
      message: result.isNew ? 'New anonymous user created' : 'Existing user found'
    });

  } catch (error) {
    console.error('Anonymous auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

/**
 * POST /api/auth/register
 * Email/Password ile kayıt ol
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const result = await registerWithEmail(email, password, deviceId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      user: result.user,
      session: result.session,
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

/**
 * POST /api/auth/login
 * Email/Password ile giriş yap
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const result = await loginWithEmail(email, password);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      user: result.user,
      session: result.session,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

/**
 * POST /api/auth/migrate
 * Anonymous user'ı registered user'a dönüştür
 */
router.post('/migrate', async (req, res) => {
  try {
    const { anonymousUserId, email, password } = req.body;

    if (!anonymousUserId || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Anonymous user ID, email and password are required'
      });
    }

    const result = await migrateAnonymousToAuth(anonymousUserId, email, password);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      user: result.user,
      session: result.session,
      message: 'Migration successful'
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed'
    });
  }
});

/**
 * ✅ YENİ: POST /api/auth/save-account
 * Anonymous user'dan soft email capture (soft prompt)
 */
router.post('/save-account', async (req, res) => {
  try {
    const { email, anonymousUserId } = req.body;

    if (!email || !anonymousUserId) {
      return res.status(400).json({
        success: false,
        error: 'Email and user ID are required'
      });
    }

    console.log('💾 Save account request:', email, anonymousUserId);

    const result = await saveAccount(anonymousUserId, email);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      user: result.user,
      session: result.session,
      message: 'Account saved successfully'
    });

  } catch (error) {
    console.error('Save account error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save account'
    });
  }
});

/**
 * POST /api/auth/forgot-password
 * Password reset email gönder
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const result = await sendPasswordReset(email);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Password reset email sent'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send reset email'
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Password'ü güncelle
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password is required'
      });
    }

    const result = await updatePassword(newPassword);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

/**
 * GET /api/auth/user/:userId
 * Kullanıcı bilgilerini getir
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await getUserById(userId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      user: result.user
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

/**
 * GET /api/auth/google
 * Google OAuth başlat (hazırlık)
 */
router.get('/google', async (req, res) => {
  try {
    const result = await loginWithGoogle();

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.redirect(result.url);

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      success: false,
      error: 'Google login failed'
    });
  }
});

module.exports = router;