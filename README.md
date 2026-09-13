# SimNova Pro — eSIM Storefront + Client Portal + Admin Panel

A complete Node.js/Express eSIM management system with a modern storefront, customer accounts, manual payment proof verification, order management and eSIM QR delivery.

## Included

- Modern animated SimNova storefront
- Searchable eSIM plans
- Client registration/login
- Customer dashboard and order history
- Checkout with admin-managed payment methods
- Payment screenshot + transaction reference upload
- Admin dashboard
- Full order status management
- Payment proof preview inside admin
- eSIM delivery by SM-DP+ / activation code or full LPA text
- Automatic QR generation after admin delivery
- Customer QR + activation details page
- eSIM plan add/edit/archive
- Payment method add/edit/remove/hide
- Customer block/activate controls
- Store settings editor
- Admin password change
- Password hashing, sessions, rate limiting, file type/size checks
- SQLite database — no separate database server needed

## Requirements

- Node.js **22 LTS** recommended
- npm

## First setup (Windows PowerShell)

1. Extract the ZIP.
2. Open PowerShell inside the `simnova-pro` folder.
3. Install packages:

```powershell
npm.cmd install
```

4. Create `.env`:

```powershell
Copy-Item .env.example .env
```

5. Edit `.env` and set a long random `SESSION_SECRET`, your admin username and admin password.
6. Seed the database:

```powershell
npm.cmd run seed
```

7. Start the server:

```powershell
npm.cmd start
```

8. Open:

- Storefront: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`

### Admin login

The seed script creates an internal admin email using your username, but the admin login accepts either the admin **username** or that email. Use the password from your `.env` file.

## Typical order flow

1. Customer creates an account.
2. Customer selects an eSIM and chooses a payment method.
3. Order is created with `pending_payment` status.
4. Customer uploads payment screenshot + optional transaction reference.
5. Admin opens the order and verifies the screenshot.
6. Admin changes status to `paid` or `processing`.
7. Admin enters eSIM SM-DP+ address + activation code (or full LPA text).
8. SimNova generates a QR code and marks the order `delivered`.
9. The QR code and activation details instantly appear in the customer's account.

## Important production notes

This package is ready for local testing and self-hosted deployment, but before taking real public orders you should also:

- Put it behind HTTPS (Nginx/Caddy/Cloudflare).
- Set secure cookies when using HTTPS (`secure: true` in session cookie configuration).
- Back up `db/simnova.db` and the `uploads/` folder.
- Use a long, private `SESSION_SECRET`.
- Change the admin password after setup.
- Keep Node/npm dependencies patched.
- Consider object storage (S3/R2) instead of local uploads when scaling.
- Add automated email/WhatsApp notifications if required.
- Integrate a real eSIM provider API later if you want automatic stock/provisioning instead of manual eSIM assignment.

## Data files

- Main database: `db/simnova.db`
- Session database: `db/sessions.db`
- Uploaded payment screenshots and generated QR images: `uploads/`

## Branding

Store name, headline, currency and support details can be changed inside **Admin → Store Settings**.


## Quick Windows helpers

- `SETUP-WINDOWS.bat` — installs dependencies and prepares `.env`.
- `SEED-DATABASE.bat` — creates the admin account, sample plans and payment methods.
- `START-SIMNOVA.bat` — starts the website after setup.
