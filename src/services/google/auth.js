const { google } = require('googleapis');
const { query } = require('../../db/pool');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',         // Create/manage files in Drive
  'https://www.googleapis.com/auth/calendar.readonly',   // Read calendar events
  'https://www.googleapis.com/auth/userinfo.email',      // Get Google account email
];

// Gmail scopes are restricted and require a paid security assessment.
// Kept here for future use once the app is verified.
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/api/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl(state) {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

async function exchangeCode(code) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

// Get an authenticated client for a user, auto-refreshing if needed
async function getAuthedClient(userId) {
  const { rows } = await query('SELECT * FROM google_tokens WHERE user_id = $1', [userId]);
  if (!rows.length) return null;

  const tokenRow = rows[0];
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    token_type: tokenRow.token_type,
    expiry_date: parseInt(tokenRow.expiry_date) || 0,
  });

  // Check if token is expired or about to expire (5 min buffer)
  const now = Date.now();
  const expiry = parseInt(tokenRow.expiry_date) || 0;
  if (expiry > 0 && expiry - now < 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      await query(
        `UPDATE google_tokens SET access_token = $1, expiry_date = $2, updated_at = NOW() WHERE user_id = $3`,
        [credentials.access_token, credentials.expiry_date, userId]
      );
      oauth2.setCredentials(credentials);
    } catch (e) {
      console.error('[google] Token refresh failed for user', userId, e.message);
      return null;
    }
  }

  return oauth2;
}

async function saveTokens(userId, tokens) {
  // Get the connected Google email
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials(tokens);
  let connectedEmail = null;
  try {
    const oauth2Info = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data } = await oauth2Info.userinfo.get();
    connectedEmail = data.email;
  } catch (e) { /* non-critical */ }

  await query(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, token_type, expiry_date, scope, connected_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       access_token = $2, refresh_token = COALESCE(NULLIF($3, ''), google_tokens.refresh_token),
       token_type = $4, expiry_date = $5, scope = $6,
       connected_email = COALESCE($7, google_tokens.connected_email),
       updated_at = NOW()`,
    [userId, tokens.access_token, tokens.refresh_token || '',
     tokens.token_type || 'Bearer', tokens.expiry_date || 0,
     SCOPES.join(' '), connectedEmail]
  );

  return connectedEmail;
}

async function revokeTokens(userId) {
  const { rows } = await query('SELECT access_token FROM google_tokens WHERE user_id = $1', [userId]);
  if (rows.length) {
    try {
      const oauth2 = getOAuth2Client();
      await oauth2.revokeToken(rows[0].access_token);
    } catch (e) { /* best effort */ }
  }
  await query('DELETE FROM google_tokens WHERE user_id = $1', [userId]);
}

async function isConnected(userId) {
  const { rows } = await query(
    'SELECT connected_email, scope, connected_at FROM google_tokens WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) return { connected: false };
  return {
    connected: true,
    email: rows[0].connected_email,
    connectedAt: rows[0].connected_at,
    scopes: (rows[0].scope || '').split(' '),
  };
}

module.exports = { getOAuth2Client, getAuthUrl, exchangeCode, getAuthedClient, saveTokens, revokeTokens, isConnected, SCOPES };
