# ESP3D Web Installer

[![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)

A modern, browser-based firmware installer for ESP32 devices using the Web Serial API. Flash your ESP32 directly from your browser without installing any software.

![ESP3D Web Installer Screenshot](images/screenshot.png)

## ✨ Features

- **No installation required** - Works directly in Chrome, Edge, or Opera
- **Multi-project support** - Configure multiple firmware projects with a 3D carousel selector
- **Multi-language support** - English and French included, easily extensible
- **Progress tracking** - Real-time progress bar and detailed console logs
- **Error categorization** - Detailed error logging for debugging and improvement
- **Flash statistics** - Track successful flashes per project
- **Fully customizable** - Branding, colors, footer links via configuration files
- **Privacy-focused** - All firmware flashing happens locally in your browser
- **Offline capable** - No external CDN dependencies (ESPTool.js hosted locally)

## 🚀 Quick Start

### Prerequisites

- A web server with PHP support (Apache, Nginx, or local development server)
- A compatible browser: Chrome 89+, Edge 89+, or Opera 75+
- ESP32 device with USB connection

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/luc-github/esp3d-webinstaller.git
   cd esp3d-webinstaller
   ```

2. **Download ESPTool.js bundle:**
   ```bash
   curl -L "https://unpkg.com/esptool-js@0.4.5/bundle.js" -o js/esptool-bundle.js
   ```
   Or download manually from [unpkg.com/esptool-js@0.4.5/bundle.js](https://unpkg.com/esptool-js@0.4.5/bundle.js)

3. **Add your firmware files:**
   ```
   firmware/
   └── your-project/
       ├── bootloader.bin
       ├── partitions.bin
       └── firmware.bin
   ```

4. **Configure your project** (see [Configuration](#-configuration) section)

5. **Deploy to your web server** or test locally:
   ```bash
   # Using PHP built-in server
   php -S localhost:8000
   ```

6. **Open in browser:** `http://localhost:8000`

## 📁 Project Structure

```
esp3d-webinstaller/
├── index.html              # Main application page
├── privacy.html            # Privacy policy page
├── terms.html              # Terms of service page
├── style.css               # Application styles
│
├── js/
│   ├── script.js           # Main application logic
│   └── esptool-bundle.js   # ESPTool.js library (download separately)
│
├── config.json             # Project/firmware configuration
├── page-config.json        # Page branding and settings
│
├── lang/
│   ├── en.json             # English translations
│   └── fr.json             # French translations
│
├── log-flash.php           # Flash event logging endpoint
├── get-flash-counts.php    # Retrieve flash statistics
├── get-flash-errors.php    # Retrieve detailed error logs
├── flash-counts.json       # Flash statistics data
├── flash-errors.json       # Detailed error logs
│
├── images/
│   ├── powered-logo.png    # Header logo
│   ├── favicon.ico         # Browser favicon
│   └── espressif.png       # Credits logo
│
└── firmware/
    └── your-project/
        ├── bootloader.bin
        ├── partitions.bin
        └── firmware.bin
```

## ⚙️ Configuration

### `config.json` - Firmware Projects

This file defines the firmware projects available in the installer.

```json
{
  "projects": [
    {
      "id": "my-project",
      "name": "My ESP32 Project",
      "enabled": true,
      "description": {
        "en": "English description of your project",
        "fr": "Description française de votre projet"
      },
      "version": "1.0.0",
      "firmware": [
        { "path": "my-project/bootloader.bin", "offset": "0x1000" },
        { "path": "my-project/partitions.bin", "offset": "0x8000" },
        { "path": "my-project/firmware.bin", "offset": "0x10000" }
      ],
      "image": "images/my-project.png",
      "icon": "images/my-project-icon.svg",
      "url": "https://your-project-website.com",
      "documentation": "https://your-project-docs.com",
      "badge": {
        "en": "Stable",
        "fr": "Stable"
      }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the project |
| `name` | string | Display name shown in the carousel |
| `enabled` | boolean | Set to `false` to show as "coming soon" |
| `description` | object | Localized descriptions (en, fr, etc.) |
| `version` | string | Firmware version displayed on the card |
| `firmware` | array/string | Firmware files with flash offsets |
| `image` | string | Project card image (optional) |
| `icon` | string | Small icon for the card header (optional) |
| `url` | string | Link to project website (optional) |
| `documentation` | string | Link to documentation (optional) |
| `badge` | object | Localized badge text (e.g., "Beta", "Stable") |

### `page-config.json` - Page Settings

This file configures branding, links, and visual settings.

```json
{
  "branding": {
    "logo": "images/powered-logo.png",
    "favicon": "images/favicon.ico"
  },
  },
  "languages": [
    {
      "code": "en",
      "name": "English",
      "default": true
    },
    {
      "code": "fr",
      "name": "Français"
    }
  ],
  "links": {
  "links": {
    "github": {
      "enabled": true,
      "url": "https://github.com/your-repo/issues/new"
    }
  },
  "footer": {
    "enabled": true,
    "links": [
      { "key": "privacyPolicy", "url": "privacy.html" },
      { "key": "termsOfService", "url": "terms.html" }
    ]
  },
  "browser_compatibility": {
    "show_warning": true,
    "supported_browsers": ["Chrome", "Edge", "Opera"]
  },
  "theme": {
    "primary_color": "#667eea",
    "secondary_color": "#764ba2",
    "success_color": "#00ff00",
    "error_color": "#ff5555",
    "warning_color": "#ffaa00"
  },
  },
  "start_sound": {
    "enabled": true,
    "path": "sounds/start.mp3",
    "volume": 0.7
  },
  "success_sound": {
    "enabled": true,
    "path": "sounds/success.mp3",
    "volume": 0.8
  },
  "error_sounds": {
    "enabled": true,
    "volume": 0.7,
    "sounds": {
      "user_cancel": "sounds/cancel.mp3",
      "connection_timeout": "sounds/timeout.mp3",
      "port_busy": "sounds/busy.mp3",
      "hardware_error": "sounds/hardware-error.mp3",
      "download_failed": "sounds/download-error.mp3",
      "wrong_browser": "sounds/browser-error.mp3",
      "flash_error": "sounds/flash-error.mp3",
      "default": "sounds/error.mp3"
    }
  }
}
```

| `analytics`|`false` for static hosting (GitHub Pages),`true` for PHP server with logging |
| `branding` | Logo and favicon paths |
| `languages` | Available languages configuration |
| `links.github` | "Report Issue" button configuration |
| `footer` | Footer visibility and legal page links |
| `browser_compatibility` | Warning for unsupported browsers |
| `theme` | Color scheme (CSS variables) |
| `start_sound` | Start sound configuration (optional) |
| `success_sound` | Success sound configuration (optional) |
| `error_sounds` | Error sounds configuration (optional) |

#### Languages Configuration

The `languages` section configures which languages are available. The language selector automatically hides when only one language is configured.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `code` | string | Yes | Language code (must match filename in `lang/` folder) |
| `name` | string | Yes | Display name in language selector |
| `default` | boolean | No | Set to `true` for default language (only one) |

**Examples:**

```json
// Multiple languages (selector visible)
"languages": [
  { "code": "en", "name": "English", "default": true },
  { "code": "fr", "name": "Français" },
  { "code": "es", "name": "Español" }
]

// Single language (selector hidden)
"languages": [
  { "code": "en", "name": "English", "default": true }
]

// If omitted, defaults to English only
```

**Adding a new language:**

1. Create translation file: `lang/es.json` (copy from `lang/en.json`)
2. Translate all values in the file
3. Add to `page-config.json`:
   ```json
   { "code": "es", "name": "Español" }
   ```

No code changes needed - the language selector updates automatically!

#### Audio Notification System

The audio notification system provides audio feedback at three key moments during the flashing process. All sounds are **completely optional** and **fully configurable**.

**Three types of sounds:**

1. **Start Sound** 🚀 - Plays when flash begins ("Ok let's go!")
2. **Success Sound** 🎉 - Plays when flash completes successfully
3. **Error Sounds** ❌ - Different sounds for different error types

##### Start Sound Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable start sound |
| `path` | string | `"sounds/start.mp3"` | Path to the MP3 file |
| `volume` | number | `0.7` | Volume level (0.0 to 1.0) |

##### Success Sound Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable success sound |
| `path` | string | `"sounds/success.mp3"` | Path to the MP3 file |
| `volume` | number | `0.7` | Volume level (0.0 to 1.0) |

##### Error Sounds Configuration

Error sounds are categorized by error type, providing precise audio feedback.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable error sounds |
| `volume` | number | `0.7` | Global volume for all error sounds |
| `sounds` | object | `{}` | Map of error categories to sound files |

**Error Categories:**

| Category | When it occurs | Suggested sound |
|----------|----------------|-----------------|
| `user_cancel` | User cancelled port selection | Soft/gentle sound |
| `connection_timeout` | Timeout connecting to ESP32 | Clock ticking or timeout beep |
| `port_busy` | Serial port in use by another app | Busy signal |
| `hardware_error` | ESP32 chip or flash memory error | Critical error beep |
| `download_failed` | Failed to download firmware files | Download error sound |
| `wrong_browser` | Unsupported browser | Incompatible beep |
| `flash_error` | Generic flash/write error | Standard error beep |
| `default` | Any other error | General error sound |

**Complete example:**

```json
{
  "start_sound": {
    "enabled": true,
    "path": "sounds/start.mp3",
    "volume": 0.7
  },
  "success_sound": {
    "enabled": true,
    "path": "sounds/success.mp3",
    "volume": 0.8
  },
  "error_sounds": {
    "enabled": true,
    "volume": 0.7,
    "sounds": {
      "user_cancel": "sounds/cancel.mp3",
      "connection_timeout": "sounds/timeout.mp3",
      "port_busy": "sounds/busy.mp3",
      "hardware_error": "sounds/hardware-error.mp3",
      "download_failed": "sounds/download-error.mp3",
      "wrong_browser": "sounds/browser-error.mp3",
      "flash_error": "sounds/flash-error.mp3",
      "default": "sounds/error.mp3"
    }
  }
}
```

**Minimal setup (just success):**

```json
{
  "success_sound": {
    "enabled": true
  }
}
```

**File structure with sounds:**

```
esp3d-webinstaller/
├── index.html
├── page-config.json
├── sounds/
│   ├── start.mp3              ← Start sound
│   ├── success.mp3            ← Success sound
│   ├── cancel.mp3             ← User cancelled
│   ├── timeout.mp3            ← Connection timeout
│   ├── busy.mp3               ← Port busy
│   ├── hardware-error.mp3     ← Hardware error
│   ├── download-error.mp3     ← Download failed
│   ├── browser-error.mp3      ← Wrong browser
│   ├── flash-error.mp3        ← Flash error
│   └── error.mp3              ← Default error
└── ...
```

**Getting sound files:**
- Generate with text-to-speech: [ttsmaker.com](https://ttsmaker.com/)
- Download sound effects: [freesound.org](https://freesound.org/), [mixkit.co](https://mixkit.co/)
- Keep files under 500KB for fast loading

## 📊 Logging and Analytics

The installer includes a logging system to track flash statistics and errors, helping you understand usage patterns and debug issues.

### `flash-counts.json` - Statistics

Automatically updated with each flash attempt:

```json
{
  "My ESP32 Project": {
    "total": 150,
    "success": 142,
    "failed": 8
  }
}
```

### `flash-errors.json` - Detailed Error Logs

Captures detailed information about failures:

```json
{
  "lastUpdated": "2024-12-14T10:30:00Z",
  "totalErrors": 8,
  "categoryCounts": {
    "connection_timeout": 3,
    "user_cancel": 2,
    "port_busy": 2,
    "wrong_browser": 1
  },
  "entries": [
    {
      "id": "err_abc123",
      "timestamp": "2024-12-14T10:30:00Z",
      "project": "My ESP32 Project",
      "error": "Timeout waiting for sync",
      "category": "connection_timeout",
      "context": {
        "browser": { "name": "Chrome", "version": "120", "os": "Windows" },
        "stage": "connecting"
      }
    }
  ]
}
```

### Error Categories

| Category | Description | Typical Cause |
|----------|-------------|---------------|
| `user_cancel` | User cancelled the operation | User didn't select a port |
| `port_busy` | Serial port unavailable | Another app using the port |
| `connection_timeout` | Timeout connecting to ESP32 | BOOT button not pressed |
| `download_failed` | Failed to download firmware | Network or server issue |
| `hardware_error` | Chip or flash memory error | Hardware problem |
| `wrong_browser` | Unsupported browser | Firefox, Safari, etc. |
| `flash_error` | Generic flash error | Various causes |

### API Endpoints

**Get flash counts:**
```
GET /get-flash-counts.php
```

**Get error summary:**
```
GET /get-flash-errors.php?summary=true
```

**Get filtered errors:**
```
GET /get-flash-errors.php?category=connection_timeout&limit=50
GET /get-flash-errors.php?project=My%20Project&limit=100
```

## 🔒 File Permissions

Ensure the PHP files can write to the JSON data files:

```bash
chmod 644 flash-counts.json flash-errors.json
chmod 755 log-flash.php get-flash-counts.php get-flash-errors.php
```

On some servers, you may need to set ownership:
```bash
chown www-data:www-data flash-counts.json flash-errors.json
```

## 🌐 Browser Support

| Browser | Minimum Version | Status |
|---------|----------------|--------|
| Chrome | 89+ | ✅ Fully supported |
| Edge | 89+ | ✅ Fully supported |
| Opera | 75+ | ✅ Fully supported |
| Firefox | - | ❌ No Web Serial API |
| Safari | - | ❌ No Web Serial API |

## 🚀 Deployment

### GitHub Pages (Static)

1. Set `"analytics": false` in `page-config.json`

2. Remove PHP files (not needed):
   ```bash
   rm log-flash.php get-flash-counts.php get-flash-errors.php
   rm flash-counts.json flash-errors.json
   ```

3. Push to GitHub and enable GitHub Pages in repository settings.

4. Your installer will be available at `https://username.github.io/repository/`

### PHP Server (With Analytics)

1. Set `"analytics": true` in `page-config.json`

2. Create the secret files directory (see Security section below for placement options)

3. Generate a secret key:
   ```bash
   openssl rand -base64 32 > /path/to/secret_files/mykey.txt
   ```

4. Update the path in `log-flash.php` to match your setup:
   ```php
   'secret_key_file' => __DIR__ . '/../secret_files/mykey.txt',
   ```

5. Set permissions:
   ```bash
   chmod 700 /path/to/secret_files/
   chmod 600 /path/to/secret_files/mykey.txt
   chmod 644 flash-counts.json flash-errors.json
   chmod 755 log-flash.php get-flash-counts.php get-flash-errors.php
   ```

6. Configure allowed origins in `log-flash.php`:
   ```php
   'allowed_origins' => [
       'localhost',
       'yourdomain.com',
       'www.yourdomain.com',
   ],
   ```

7. Deploy to your PHP-enabled web server.

## 🔒 Security (PHP Server)

When running with `analytics: true`, the following security measures are implemented:

| Security Layer | Description |
|----------------|-------------|
| **Secret Key File** | Verifies script runs on legitimate server (file outside web access) |
| **Rate Limiting** | Max 10 requests/minute, 50 requests/hour per IP |
| **Input Validation** | Sanitizes all input, limits string lengths |
| **File Size Limits** | Counts: 1MB max, Errors: 5MB max |
| **Origin Check** | Validates Referer/Origin header |
| **Honeypot** | Detects bot submissions |
| **Payload Limit** | Max 10KB per request |

### Secret Files Placement

#### Option A: Outside web root (Recommended)

Place `secret_files/` at the same level as your web root, not inside it:

```
/var/www/
├── webinstaller/            <- Web root (HTTP accessible)
│   ├── index.html
│   ├── log-flash.php
│   ├── flash-counts.json
│   └── ...
└── secret_files/            <- Outside web root (NOT HTTP accessible)
    ├── mykey.txt
    └── rate_limits.json     <- Auto-generated
```

In `log-flash.php`, use:
```php
'secret_key_file' => __DIR__ . '/../secret_files/mykey.txt',
'rate_limit_file' => __DIR__ . '/../secret_files/rate_limits.json',
```

**✅ No additional web server configuration needed** - the directory is simply not served.

#### Option B: Inside web root with access denied

If you cannot place files outside the web root, put `secret_files/` inside and block access:

```
/var/www/webinstaller/       <- Web root
├── index.html
├── log-flash.php
└── secret_files/            <- Inside web root, access blocked
    ├── .htaccess            <- Required for Apache
    ├── mykey.txt
    └── rate_limits.json
```

In `log-flash.php`, use:
```php
'secret_key_file' => __DIR__ . '/secret_files/mykey.txt',
'rate_limit_file' => __DIR__ . '/secret_files/rate_limits.json',
```

**Apache** - Create `secret_files/.htaccess`:
```apache
Require all denied
```

**Nginx** - Add to your server block:
```nginx
location /secret_files/ {
    deny all;
    return 403;
}
```

### Verify Security

Test that `secret_files/` is NOT accessible:
```bash
curl -I https://yourdomain.com/secret_files/mykey.txt
# Should return 403 Forbidden or 404 Not Found
```

## 🛠️ Development

### Local Development Server

```bash
# PHP built-in server
php -S localhost:8000

# Or with Python
python -m http.server 8000
```

Note: PHP server is required for logging functionality.

### Updating ESPTool.js

To update to a newer version:
```bash
curl -L "https://unpkg.com/esptool-js@VERSION/bundle.js" -o js/esptool-bundle.js
```

Check [esptool-js releases](https://github.com/espressif/esptool-js/releases) for available versions.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For questions and discussions, please use [GitHub Discussions](https://github.com/luc-github/esp3d-webinstaller/discussions).

## 📄 License

This project is licensed under the **GNU Lesser General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

## 🙏 Credits

### ESPTool.js

This project uses the excellent [esptool-js](https://github.com/espressif/esptool-js) library for ESP32 communication.

<a href="https://github.com/espressif/esptool-js">
  <img src="images/espressif.png" alt="Espressif Systems" width="50">
</a>

**esptool-js** is developed by [Espressif Systems](https://www.espressif.com/) and is licensed under the Apache License 2.0.

### Web Serial API

Communications with ESP32 are done using [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

<a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">
  <img src="images/mozilla.png" alt="Mozilla" width="100">

The browser serial communication API from Mozilla.

<br/>
<br/>
Made with ❤️ for the ESP32 community
