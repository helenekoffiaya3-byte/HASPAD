const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { createHostingPlan } = require('../services/resellerspanel.service');

function generateTokens(userId, role) {
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET et JWT_REFRESH_SECRET sont requis.');
  }
  return {
    accessToken: jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '15m' }),
    refreshToken: jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' })
  };
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

const normalizeEmail = email => String(email || '').trim().toLowerCase();

async function register(req, res) {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const fullName = String(req.body.fullName || '').trim() || null;
  const siteName = String(req.body.siteName || '').trim() || 'Mon Premier Site';
  const subdomain = String(req.body.subdomain || '').trim().toLowerCase();

  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ message: 'Adresse e-mail invalide.' });
  if (password.length < 8)
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères.' });
  if (subdomain && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain))
    return res.status(400).json({ message: 'Sous-domaine invalide.' });

  try {
    const check = await db.query('SELECT id FROM public.users WHERE email = $1', [email]);
    if (check.rows.length) return res.status(400).json({ message: 'Cet e-mail est déjà utilisé.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO public.users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, role`,
        [email, passwordHash, fullName]
      );
      const user = result.rows[0];

      let hostingResult = null;
      if (subdomain) {
        try {
          hostingResult = await createHostingPlan(
            { email: user.email, fullName: user.full_name },
            `${subdomain}.haspad.com`
          );
        } catch (err) {
          console.warn('Provisioning ResellersPanel en attente ou échoué:', err.message);
        }

        await client.query(
          `INSERT INTO public.sites
           (user_id, name, subdomain, provider_hosting_id, status)
           VALUES ($1, $2, $3, $4, 'draft')`,
          [user.id, siteName, subdomain, hostingResult?.id || null]
        );
      }

      await client.query('COMMIT');

      const tokens = generateTokens(user.id, user.role);
      setRefreshCookie(res, tokens.refreshToken);
      return res.status(201).json({
        message: 'Compte créé avec succès !',
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
        accessToken: tokens.accessToken
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505')
      return res.status(400).json({ message: 'Cet e-mail ou ce sous-domaine est déjà utilisé.' });
    console.error('Erreur inscription:', error);
    return res.status(500).json({ message: 'Erreur lors de la création du compte.' });
  }
}

async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password)
    return res.status(400).json({ message: 'E-mail et mot de passe requis.' });

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, full_name, role FROM public.users WHERE email = $1',
      [email]
    );

    if (!result.rows.length || !result.rows[0].password_hash)
      return res.status(401).json({ message: 'Identifiants incorrects.' });

    const user = result.rows[0];
    if (!(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ message: 'Identifiants incorrects.' });

    const tokens = generateTokens(user.id, user.role);
    setRefreshCookie(res, tokens.refreshToken);

    return res.json({
      message: 'Connexion réussie !',
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
      accessToken: tokens.accessToken
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
}

module.exports = { register, login, generateTokens };
