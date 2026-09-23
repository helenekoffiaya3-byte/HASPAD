const { google } = require('googleapis');
require('dotenv').config();

function createOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont requis.');
  }

  if (!process.env.BACKEND_URL) {
    throw new Error('BACKEND_URL est requis.');
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BACKEND_URL.replace(/\/$/, '')}/api/auth/google/callback`
  );
}

function getGoogleAuthURL() {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  });
}

async function getGoogleUser(code) {
  if (!code) throw new Error('Code OAuth Google manquant.');

  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  if (!data.id || !data.email) {
    throw new Error('Profil Google incomplet.');
  }

  return data;
}

module.exports = { getGoogleAuthURL, getGoogleUser };
