function isAdminConfigured() {
  return Boolean(String(process.env.ADMIN_PASSWORD || '').trim());
}

function requireAdmin(req, res, next) {
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (!password) {
    if (isProd) {
      return res.status(503).json({
        success: false,
        error: 'Admin is not configured. Set ADMIN_PASSWORD in Render environment variables.',
      });
    }
    return next();
  }

  const header = req.headers.authorization || '';
  const challenge = () => {
    if (req.get('X-Requested-With') !== 'fetch') res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  };
  if (!header.startsWith('Basic ')) {
    challenge();
    return res.status(401).json({ success: false, error: 'Login required.' });
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  const supplied = colon >= 0 ? decoded.slice(colon + 1) : decoded;

  if (supplied !== password) {
    challenge();
    return res.status(401).json({ success: false, error: 'Invalid password.' });
  }

  return next();
}

module.exports = { requireAdmin, isAdminConfigured };
