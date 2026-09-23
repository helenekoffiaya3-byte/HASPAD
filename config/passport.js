const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const GitLabStrategy = require('passport-gitlab2').Strategy;
const BitbucketStrategy = require('passport-bitbucket-oauth2').Strategy;
const db = require('./db');

async function handleOAuthUser(provider, providerUserId, email, fullName, avatarUrl) {
  const normalizedEmail = email ? email.trim().toLowerCase() : null;
  const identity = await db.query(
    'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2',
    [provider, String(providerUserId)]
  );
  if (identity.rows.length) {
    const user = await db.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [identity.rows[0].user_id]);
    return user.rows[0];
  }

  let userId;
  if (normalizedEmail) {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) userId = existing.rows[0].id;
  }

  if (!userId) {
    const created = await db.query(
      'INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id',
      [normalizedEmail || `${providerUserId}@${provider}.auth`, fullName || null]
    );
    userId = created.rows[0].id;
  }

  await db.query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, provider_user_id) DO UPDATE
     SET email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url`,
    [userId, provider, String(providerUserId), normalizedEmail, avatarUrl || null]
  );

  const user = await db.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [userId]);
  return user.rows[0];
}

function configure(name, Strategy, options, mapper) {
  if (!process.env[options.idKey] || !process.env[options.secretKey]) return;
  passport.use(name, new Strategy({
    clientID: process.env[options.idKey],
    clientSecret: process.env[options.secretKey],
    callbackURL: `${process.env.BACKEND_URL}${options.callbackPath}`,
    ...options.strategy
  }, async (accessToken, refreshToken, profile, done) => {
    try { done(null, await handleOAuthUser(name, ...mapper(profile))); }
    catch (err) { done(err); }
  }));
}

configure('google', GoogleStrategy, {idKey:'GOOGLE_CLIENT_ID',secretKey:'GOOGLE_CLIENT_SECRET',callbackPath:'/api/auth/google/callback'}, p => [p.id,p.emails?.[0]?.value,p.displayName,p.photos?.[0]?.value]);
configure('github', GitHubStrategy, {idKey:'GITHUB_CLIENT_ID',secretKey:'GITHUB_CLIENT_SECRET',callbackPath:'/api/auth/github/callback',strategy:{scope:['user:email']}}, p => [p.id,p.emails?.[0]?.value,p.displayName || p.username,p.photos?.[0]?.value]);
configure('gitlab', GitLabStrategy, {idKey:'GITLAB_CLIENT_ID',secretKey:'GITLAB_CLIENT_SECRET',callbackPath:'/api/auth/gitlab/callback'}, p => [p.id,p.emails?.[0]?.value,p.displayName || p.username,p.avatarUrl]);
configure('bitbucket', BitbucketStrategy, {idKey:'BITBUCKET_CLIENT_ID',secretKey:'BITBUCKET_CLIENT_SECRET',callbackPath:'/api/auth/bitbucket/callback'}, p => [p.id,p.emails?.[0]?.value,p.displayName || p.username,p.photos?.[0]?.value]);

module.exports = passport;
