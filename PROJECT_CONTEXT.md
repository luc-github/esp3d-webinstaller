# Project Context: ESP3D Web Installer

This document summarizes the repository for AI-assisted development and onboarding. It is derived from analysis of the codebase and **repomix-output.xml** (a Repomix-packed representation of the repository).

---

## What This Project Is

**ESP3D Web Installer** is a browser-based firmware installer for **ESP32** devices. Users flash firmware directly from Chrome, Edge, or Opera using the **Web Serial API**—no desktop app required. Flashing runs entirely in the browser (ESPTool.js is bundled locally).

- **License:** LGPL v3  
- **Repo:** `luc-github/esp3d-webinstaller`  
- **Live:** `https://webinstaller.esp3d.io`

### Main capabilities

- Multi-project firmware selector (3D carousel)
- Multi-language (e.g. EN/FR via `lang/*.json`)
- Real-time progress, console logs, optional audio feedback
- Flash statistics and error logging (PHP backend when `analytics: true`)
- Maintenance mode (Apache SSI + `.maintenance.on` + `.htaccess`)
- Configurable branding, theme, footer, and error logging categories

---

## Repomix Output (`repomix-output.xml`)

- **Purpose:** Single packed file of the repo’s “important” subset for AI analysis, code review, or automation.
- **Format:**  
  1. File summary and usage guidelines  
  2. Repository/directory structure  
  3. Full contents of included files (path as attribute, then body)
- **Conventions:**
  - Treat as **read-only**; edit original repo files, not the packed file.
  - Use the **file path** attribute to tell files apart.
  - **Excluded:** `node_modules`, `dist`, `build`, `.git`, and patterns in `.gitignore`; binary files are not in the pack (only paths in directory structure).
  - **Order:** Files are sorted by Git change count (more-changed files toward the end).

When working from `repomix-output.xml`, use the path and the summary/structure to locate the right original file for any change.

---

## Directory and File Overview

High-level layout (aligned with `repomix-output.xml`’s `<directory_structure>`):

| Path | Role |
|------|------|
| **Root** | |
| `index.html` | Main app page; SSI for maintenance title/theme |
| `maintenance.html` | Shown to users when maintenance mode is on (except allowed IPs) |
| `style.css` | Global styles |
| `config.json` | **Firmware projects**: id, name, enabled, description, version, releaseNotes, firmware paths/offsets, image, icon, url, documentation, badge |
| `page-config.json` | **Page settings**: branding, languages, links (e.g. GitHub), footer, browser_compatibility, theme, error_logging, audio_feedback |
| `privacy.html`, `terms.html` | Legal pages linked from footer |
| `.htaccess` | HTTPS redirect, SSI for `.html`, maintenance rules, cache control |
| `.maintenance.on` | Empty file; **presence** enables maintenance (with `.htaccess` and allowed IPs) |
| **js/** | |
| `script.js` | Main app logic: config load, carousel, Web Serial, flash flow, audio queue, logging |
| `esptool-bundle.js` | ESPTool.js bundle (obtained separately, e.g. from unpkg) |
| `version.js` | Version info for the installer |
| **lang/** | |
| `en.json`, `fr.json` | Per-language strings (UI, errors, etc.) |
| **PHP (optional, for analytics)** | |
| `log-flash.php` | POST endpoint: validates secret key, rate limit, origin, honeypot; appends to `flash-counts.json` and `flash-errors.json` |
| `get-flash-counts.php` | GET: returns flash statistics |
| `get-flash-errors.php` | GET: returns error log (summary or filtered) |
| **Data (written by PHP)** | |
| `flash-counts.json` | Counts per project (total/success/failed) |
| `flash-errors.json` | Error entries with category, context, timestamps |
| **firmware/** | |
| `fluidnc4mb/`, `fluidnc8mb/` | Binaries and release notes for Pibot CNC pendant (4MB/8MB FluidNC) |
| **images/** | Logos, icons, screenshots (e.g. `powered-logo.png`, `favicon.ico`, `espressif.png`, `fluidnc.svg`, `grblHAL.svg`) |
| **sounds/** | `en/` (and optionally other langs): MP3s for audio feedback (start, boot, connected, success, error, etc.) |
| **testing/** | Mirror of production for staging; has its own `.htaccess`, `.maintenance.on`, `maintenance.html`, and optional `flash-counts.json` / `flash-errors.json` |
| **video/** | Demo/maintenance videos (e.g. `maintenance2.mp4`, `press-boot.mp4`) |

Root and `testing/` both appear in repomix; `testing/` is a deployable copy with separate maintenance and config.

---

## Tech Stack

- **Frontend:** HTML5, CSS, vanilla JavaScript (no framework)
- **Serial/Flash:** Web Serial API + **esptool-js** (bundled in `js/esptool-bundle.js`)
- **Backend (optional):** PHP for logging and analytics endpoints
- **Server:** Apache assumed for SSI and `.htaccess` (maintenance, HTTPS, cache); Nginx can be used with equivalent config
- **Config:** JSON only (`config.json`, `page-config.json`)

---

## Configuration Quick Reference

- **Firmware list and behavior:** `config.json` → `projects[]` (id, name, enabled, firmware paths/offsets, releaseNotes, badge, etc.).
- **UI, theme, logging, audio:** `page-config.json` → branding, languages, links, footer, theme, `error_logging`, `audio_feedback`.
- **Analytics:** `page-config.json` → `analytics: true` enables POST to `log-flash.php` and use of flash-counts/errors; PHP and writable JSON files required.
- **Maintenance:** Create `.maintenance.on` at doc root; `.htaccess` sets `MAINTENANCE_MODE` for allowed IPs and redirects others to `maintenance.html`.

---

## Deployment Modes

1. **Static (e.g. GitHub Pages):** Set `analytics: false`, remove or don’t use PHP and flash-count/error JSON.
2. **PHP with analytics:** Set `analytics: true`, deploy PHP, create `secret_files/` (e.g. `mykey.txt`, `rate_limits.json`), configure `log-flash.php` (paths, `allowed_origins`), make `flash-counts.json` and `flash-errors.json` writable.

---

## Security (PHP Analytics)

When analytics is on, `log-flash.php` uses: secret key file, rate limiting by IP, input validation, file size limits, origin/referer check, and honeypot. Keep `secret_files/` outside the web root or protected so the secret key is never served.

---

## Conventions for Contributors

- Do **not** edit `repomix-output.xml`; it is generated. Edit the actual source files.
- ESPTool.js is **not** in the repo; document or script the download (e.g. `esptool-js@0.4.5` from unpkg) in README or tooling.
- New languages: add `lang/<code>.json` and a corresponding entry in `page-config.json` → `languages`.
- New firmware project: add binaries under `firmware/<project>/` and an entry in `config.json` → `projects`.

---

## File Count / Scope (from repomix)

The packed `repomix-output.xml` includes the directory structure and many text files (HTML, CSS, JS, JSON, PHP, etc.). Binary assets (images, sounds, videos, firmware binaries) are listed in the directory structure but not inlined. The **testing/** tree is included as a parallel structure to the root.

Use this document together with **README.md** and **repomix-output.xml** for consistent context when changing the installer or its configuration.
