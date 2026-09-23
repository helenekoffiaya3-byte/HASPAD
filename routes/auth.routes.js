const express = require('express');
const router = express.Router();
const {
  register,
  login,
  googleRedirect,
  googleCallback
} = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', login);

router.get('/google', googleRedirect);
router.get('/google/callback', googleCallback);

module.exports = router;
