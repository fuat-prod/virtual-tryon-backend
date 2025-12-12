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
  saveAccount
} = require('./authService');

// ... (diğer route'lar aynı kalıyor)

/**
 * ✅ YENİ: POST /api/auth/save-account
 * Soft prompt'tan email + optional password
 */
router.post('/save-account', async (req, res) => {
  try {
    const { email, password, anonymousUserId } = req.body; // ✅ password eklendi

    if (!email || !anonymousUserId) {
      return res.status(400).json({
        success: false,
        error: 'Email and user ID are required'
      });
    }

    console.log('💾 Save account request:', email, 'Password:', password ? 'Yes' : 'No');

    const result = await saveAccount(anonymousUserId, email, password); // ✅ password parametre

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

// ... (diğer route'lar aynı)

module.exports = router;