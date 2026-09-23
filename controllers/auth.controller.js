const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getGoogleAuthURL, getGoogleUser } = require('../services/googleAuth.service');
const { createHostingPlan } = require('../services/resellerspanel.service');

function generateToken(userId, role) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET est requis.');
  }
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

function setRefreshCookie(res, token) {
  if (!token) return;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `refreshToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict${secure}`
  );
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

async function register(req, res) {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const fullName = String(req.body?.fullName || '').trim().slice(0, 255) || null;
  const subdomain = String(req.body?.subdomain || '').trim().toLowerCase();
  const siteName = String(req.body?.siteName || '').trim().slice(0, 255) || 'Mon Site';

  if (!validEmail(email)) return res.status(400).json({ message: 'Adresse e-mail invalide.' });
  if (password.length < 8) return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères.' });
  if (subdomain && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    return res.status(400).json({ message: 'Sous-domaine invalide.' });
  }

  try {
    const userCheck = await db.query('SELECT id FROM public.users WHERE email = $1', [email]);
    if (userCheck.rows.length) {
      return res.status(400).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const newUser = await client.query(
        `INSERT INTO public.users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, role`,
        [email, passwordHash, fullName]
      );

      const user = newUser.rows[0];
      let hostingResult = null;

      if (subdomain) {
        try {
          hostingResult = await createHostingPlan(
            { email: user.email, fullName: user.full_name },
            `${subdomain}.haspad.com`
          );
        } catch (err) {
          console.warn('Création hébergement en attente/échec:', err.message);
        }

        await client.query(
          `INSERT INTO public.sites
           (user_id, name, subdomain, provider_hosting_id, status)
           VALUES ($1, $2, $3, $4, 'draft')`,
          [user.id, siteName, subdomain, hostingResult?.id || null]
        );
      }

      await client.query('COMMIT');

      const token = generateToken(user.id, user.role);
      return res.status(201).json({
        message: 'Compte créé !',
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erreur inscription:', error);
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Cet e-mail ou ce sous-domaine est déjà utilisé.' });
    }
    return res.status(500).json({ message: 'Erreur lors de l’inscription.' });
  }
}

async function login(req, res) {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!validEmail(email) || !password) {
    return res.status(400).json({ message: 'E-mail et mot de passe requis.' });
  }

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, full_name, role FROM public.users WHERE email = $1',
      [email]
    );

    if (!result.rows.length || !result.rows[0].password_hash) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    const user = result.rows[0];
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    const token = generateToken(user.id, user.role);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    return res.status(500).json({ message: 'Erreur lors de la connexion.' });
  }
}

function googleRedirect(req, res) {
  try {
    res.redirect(getGoogleAuthURL());
  } catch (error) {
    console.error('Erreur redirection Google:', error);
    res.status(500).json({ message: 'Google OAuth n’est pas configuré.' });
  }
}

async function googleCallback(req, res) {
  const code = String(req.query?.code || '');
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    const googleProfile = await getGoogleUser(code);
    const googleId = String(googleProfile.id);
    const email = normalizeEmail(googleProfile.email);
    const name = String(googleProfile.name || '').trim().slice(0, 255) || null;
    const picture = googleProfile.picture || null;

    let userResult = await db.query(
      `SELECT u.id, u.email, u.full_name, u.role
       FROM public.users u
       JOIN public.user_identities ui ON u.id = ui.user_id
       WHERE ui.provider = 'google' AND ui.provider_user_id = $1`,
      [googleId]
    );

    let user;

    if (userResult.rows.length) {
      user = userResult.rows[0];
    } else {
      const emailCheck = await db.query(
        'SELECT id, email, full_name, role FROM public.users WHERE email = $1',
        [email]
      );

      if (emailCheck.rows.length) {
        user = emailCheck.rows[0];
      } else {
        const newUser = await db.query(
          `INSERT INTO public.users (email, full_name)
           VALUES ($1, $2)
           RETURNING id, email, full_name, role`,
          [email, name]
        );
        user = newUser.rows[0];
      }

      await db.query(
        `INSERT INTO public.user_identities
         (user_id, provider, provider_user_id, email, avatar_url)
         VALUES ($1, 'google', $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO UPDATE
         SET email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url`,
        [user.id, googleId, email, picture]
      );
    }

    const token = generateToken(user.id, user.role);
    const url = new URL('/auth/success', frontend);
    url.searchParams.set('token', token);
    return res.redirect(url.toString());
  } catch (error) {
    console.error('Erreur Callback Google:', error);
    const url = new URL('/connexion.html', frontend);
    url.searchParams.set('oauth', 'error');
    return res.redirect(url.toString());
  }
}

module.exports = { register, login, googleRedirect, googleCallback, generateToken, setRefreshCookie };
