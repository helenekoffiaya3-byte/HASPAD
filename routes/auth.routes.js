const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { register, login } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', login);

function callback(provider) {
  return [
    passport.authenticate(provider, { session: false, failureRedirect: '/connexion.html?oauth=error' }),
    (req, res) => {
      if (!process.env.JWT_SECRET) return res.status(500).send('JWT_SECRET non configuré.');
      const token = jwt.sign({ userId: req.user.id, role: req.user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
      const frontend = process.env.FRONTEND_URL || process.env.BACKEND_URL || 'http://localhost:3000';
      const url = new URL('/auth/success', frontend);
      url.searchParams.set('token', token);
      res.redirect(url.toString());
    }
  ];
}

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', ...callback('google'));
router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
router.get('/github/callback', ...callback('github'));
router.get('/gitlab', passport.authenticate('gitlab', { scope: ['read_user'] }));
router.get('/gitlab/callback', ...callback('gitlab'));
router.get('/bitbucket', passport.authenticate('bitbucket'));
router.get('/bitbucket/callback', ...callback('bitbucket'));

module.exports = router;
