# entrytwo - Security & Compliance

**Project:** entrytwo  
**Status:** Draft v1  
**Date:** June 2026

---

## 1. Purpose

This document outlines the security and compliance considerations for entrytwo. Since this is an accounting system that handles sensitive financial data, security must be taken seriously from the beginning.

---

## 2. Core Security Principles

| Principle              | Description |
|------------------------|-------------|
| **Data Ownership**     | Users own their data (self-hosted) |
| **Least Privilege**    | Users and the AI agent should only have access to what they need |
| **Auditability**       | Every action must be logged |
| **Defense in Depth**   | Multiple layers of protection |
| **Transparency**       | Users should understand what the AI is doing |

---

## 3. Authentication & Authorization

### Recommended Approach (MVP)

- **Magic Link via Email** as primary authentication method
- Session management using secure httpOnly cookies
- Role-Based Access Control (RBAC) with roles: Admin, Accountant, Viewer

### Future Enhancements

- Optional TOTP (Authenticator App) as second factor
- OAuth support (Google, Microsoft)
- IP whitelisting / rate limiting on login

---

## 4. Data Protection

### At Rest

- Use PostgreSQL with encryption at rest (if hosting provider supports it)
- Never store plaintext sensitive data
- Hash passwords using bcrypt or Argon2 (if password login is added)

### In Transit

- Enforce HTTPS for all production deployments
- Use secure headers (HSTS, CSP, etc.)

### AI Data Handling

- The AI agent should only access data through controlled tools
- Never send full financial datasets to LLMs unless necessary
- Prefer structured tool outputs over raw context dumping

---

## 5. Audit & Logging

Every change to financial data must be logged with:

- User ID (or "AI" if triggered by agent)
- Timestamp
- Action type
- Before and after values (when applicable)
- IP address (optional but recommended)

The `Event` table should serve as the central audit log.

---

## 6. AI Agent Security

This is one of the most critical areas:

- All AI actions that modify data must go through an **approval system**
- The agent should only be able to call predefined tools
- Tool permissions should be restricted based on user role
- Implement verification steps before executing high-risk actions
- Log every AI decision and reasoning (for debugging and compliance)

---

## 7. Self-Hosting Security Recommendations

Since entrytwo is self-hosted, users are responsible for security. We should provide clear guidance in the documentation, including:

- Use strong, unique passwords for the database
- Keep the server and dependencies updated
- Use a reverse proxy (Nginx / Caddy) with HTTPS
- Regularly back up the database
- Restrict database access to the application only
- Monitor logs for suspicious activity

---

## 8. Compliance Considerations

| Area             | Recommendation |
|------------------|----------------|
| **Data Privacy** | Clearly document what data is stored and how it is used |
| **Audit Trail**  | Maintain immutable logs of all financial changes |
| **Access Control** | Enforce role-based permissions |
| **Data Retention** | Allow users to export and delete their data |
| **GDPR Readiness** | Support data export and deletion requests (future) |
| **Tax Compliance** | The system must correctly record and report jurisdiction-specific taxes (VAT, MwSt, sales tax, etc.). Tax handling is a core compliance requirement from Phase 0. Incorrect tax data is a serious compliance risk. |
| **Internationalization / Localization** | All user-facing content must be translatable. Reports, invoices, and legal documents must be generatable in the user's language and with correct locale formatting. This is a compliance and usability requirement. |

---

## 9. Known Risks & Mitigations

| Risk                              | Mitigation Strategy |
|-----------------------------------|---------------------|
| AI making unauthorized changes    | Strict approval workflow + verification |
| Data breach on self-hosted server | Clear security documentation + recommendations |
| Prompt injection / malicious input| Input sanitization + tool permission restrictions |
| Weak authentication               | Start with Magic Link + plan for 2FA |

---

## 10. Next Steps

- Define tool permissions for the AI agent
- Create security documentation for self-hosters
- Add rate limiting and basic security headers in the application
- Plan for future compliance features (data export, retention policies)
- **Verify that i18n framework is in place and all user-facing strings are externalized before any production-like use**
- **Validate that the tax model + journal flows support correct multi-jurisdiction tax recording and reporting from Phase 0**

---

**Document Status:** Draft v1 (updated with i18n + tax compliance requirements)

**Implementation note (2026-06-24):** i18n and tax data collection are live. All UI text translatable. Tax amounts are captured at source on journal lines. Multi-currency fields added to JournalLine (currency, fxRateToBase, fxSource, fxDate). Chat Lock (advisory-only) implemented as safety control.