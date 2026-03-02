Secure authentication - design & integration notes

What I added
- express-session integration (server/index.js)
- `server/middleware/authMiddleware.js` - session route protection helpers
- `server/controllers/secureAuthController.js` - session login/logout + suspicious-login detection
- `server/routes/secureAuth.js` - example endpoints (/api/auth/secure/login)
- Mongoose models: `LoginHistory`, `FailedLoginAttempt`, `AuthSession`
- package.json deps: express-session, connect-mongo, ua-parser-js, geoip-lite

How to use / integrate
1) Install new deps:
   npm install express-session connect-mongo ua-parser-js geoip-lite

2) Start server (dev):
   npm run dev

3) New endpoints (optional):
   POST /api/auth/secure/login  -> session-based login (math-captcha + password)
   POST /api/auth/secure/logout -> destroys session

4) Protect routes using `authMiddleware.requireLogin` instead of JWT `pageAuth` for new endpoints.
   Example: app.use('/profile', requireLogin, profileRouter)

Security highlights
- Server-side sessions stored in MongoDB (connect-mongo)
- Session cookies are httpOnly, secure (when NODE_ENV=production) and sameSite=Strict
- Regenerate session ID on successful login
- LoginHistory collects IP, UA, device, geo for suspicious detection
- FailedLoginAttempt model implements temporary lockouts after repeated failures

Notes
- I purposely left existing JWT-based auth intact for backwards compatibility. You can migrate fully to express-session by replacing uses of `pageAuth`/`authenticate` with `authMiddleware`.
- 2FA on new device is notified via email (example included). You can extend `secureAuthController` to require an OTP before completing login.

Environment / admin provisioning 🧾

- The repository supports creating a bootstrap admin account with `server/scripts/createAdmin.js` and the following environment variables.

  - `ADMIN_EMAIL` (required by the script) — admin account email used when creating/updating the admin user.
  - `ADMIN_PASSWORD` (required by the script) — password for the admin account.
  - `ADMIN_FIRSTNAME` (optional) — first name to populate the admin user profile (defaults to `Admin`).
  - `ADMIN_LASTNAME` (optional) — last name to populate the admin user profile (defaults to `User`).
  - `ADMIN_PHONE` (optional) — phone number to populate the admin user profile (defaults to `0000000000`).

- Usage examples

  - Create/update admin using environment variables:

      ADMIN_EMAIL=admin@yourdomain.com ADMIN_PASSWORD=Str0ngPass! node server/scripts/createAdmin.js

  - Provide optional profile fields so the created user satisfies the `User` schema:

      ADMIN_EMAIL=admin@yourdomain.com ADMIN_PASSWORD=Str0ngPass! ADMIN_FIRSTNAME=Jane ADMIN_LASTNAME=Doe ADMIN_PHONE=09171234567 node server/scripts/createAdmin.js

- There's an example env file at the project root: `.env.example` — copy it to `.env` and populate secrets before running the server.

Security tip: Never commit your real `.env` file or secrets into version control. Use secure secret stores for production deployments.
