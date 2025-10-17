const express = require('express');
const router = express.Router();
const { createOrGetAnonymousUser, getUserById } = require('./userService');

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

module.exports = router;