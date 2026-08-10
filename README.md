# CNCmarketplace Full Stack v1

This version adds a real local backend:
- User registration/login with sessions
- Admin login
- Admin design upload (up to 200 MB)
- Persistent JSON database
- Public product API
- Real free-file downloads for logged-in users
- Download tracking
- Product deletion and admin statistics
- Premium product flag (payment gateway intentionally not connected)

## Run
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run `npm install`
4. Set a strong SESSION_SECRET.
5. Optional admin variables:
   ADMIN_EMAIL=your@email.com
   ADMIN_PASSWORD=your-strong-password
6. Run `npm start`
7. Open http://localhost:3000
8. Admin: http://localhost:3000/admin

IMPORTANT:
The included admin credentials are demo defaults. Change them before hosting publicly.
Real bKash/Nagad/card payment requires merchant credentials and a payment gateway integration.
For production, move file storage/database to managed services and use HTTPS.


## Render deployment (recommended for the first online test)

1. Create a GitHub repository and upload this entire folder.
2. In Render, create **New → Web Service** and connect that GitHub repository.
3. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: `Free`
4. Add environment variables:
   - `ADMIN_EMAIL` = your chosen CNCmarketplace admin email
   - `ADMIN_PASSWORD` = a NEW CNCmarketplace admin password (do NOT use your Gmail password)
   - `SESSION_SECRET` = a long random secret (Render can generate this)
5. Deploy.

Render gives the service a public `onrender.com` URL. Free web services can spin down after 15 minutes of inactivity and local filesystem changes are not persistent across redeploys/restarts, so this package is suitable for a prototype/test. For a real marketplace with permanent uploaded CNC files, we should next move uploads to persistent object storage and the JSON data to a managed database. Render documents these free-tier limitations here: https://render.com/docs/free


## v2 image previews
Admin can upload an optional JPG/PNG/WEBP preview image together with each DXF/STL/CDR file. The image appears on the storefront and admin library.
