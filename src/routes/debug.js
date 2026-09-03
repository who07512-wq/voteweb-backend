
// Debug: Check Brevo config
router.get('/brevo-status', (req, res) => {
  const hasApiKey = !!process.env.BREVO_API_KEY;
  const hasSenderEmail = !!process.env.BREVO_SENDER_EMAIL;
  const hasSenderName = !!process.env.BREVO_SENDER_NAME;
  
  res.json({
    hasApiKey,
    hasSenderEmail,
    hasSenderName,
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'NOT SET',
    senderName: process.env.BREVO_SENDER_NAME || 'NOT SET',
    apiKeyLength: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0,
  });
});
