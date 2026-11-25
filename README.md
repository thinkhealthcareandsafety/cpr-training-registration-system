# CPR Training Registration System

Registration, photo and certificate system for Hands-Only CPR training, by Think Health Care and Safety.

1. A participant scans the QR code and registers with name, email and phone.
2. The team opens the admin page, takes the participant's photo and saves it.
3. The certificate (PDF) and photo are emailed to the participant automatically.

## Run it (Windows)

1. Install [Node.js](https://nodejs.org) 22.13 or newer.
2. In this folder run `npm install`.
3. Download [cloudflared for Windows](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe) and save it as `bin/cloudflared.exe`.
4. Double-click `start.bat`. The window shows the participant link and the admin link. Keep it open.

The computer must stay on and online. Each start gives a new link, so update `docs/index.html` (both places) to keep the permanent link and printed QR code working.

## Use it

- **Admin:** add `/admin` to the link. The first password is in `data/admin-password.txt`. Change it in the Password tab.
- **Email:** connect a Gmail, Google Workspace or Zoho account with an app password in the Email tab.
- **Certificate:** the design is in `public/art`. The positions of the name, photo and signature are in `public/cert-layout.js`.

## Private data

Participants, photos, certificates and the saved app password are stored only in `data/` on the computer that runs the system. That folder is never uploaded here. Back it up and keep it private.

## Permanent link

`docs/` is a small page for GitHub Pages that forwards guests to the running system.
