/** Shared SMTP detection — keep free of nodemailer / next-auth so edge/middleware stay light. */
export function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}
