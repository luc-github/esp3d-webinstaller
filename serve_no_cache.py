#!/usr/bin/env python3
"""
Minimal HTTP server with no-cache headers for development.
Use instead of: python -m http.server 8181

Usage:
  python serve_no_cache.py [port]
  python serve_no_cache.py 8181

Sends strong no-cache headers on every response so the browser never uses cache.
"""

import http.server
import socketserver
import sys

# Force browser to never use cache (applied to every response)
NO_CACHE_HEADERS = [
    ('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'),
    ('Pragma', 'no-cache'),
    ('Expires', '0'),
]


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for key, value in NO_CACHE_HEADERS:
            self.send_header(key, value)
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8181
    with socketserver.TCPServer(('', port), NoCacheHTTPRequestHandler) as httpd:
        print(f'Serving at http://localhost:{port}/ (no-cache on all responses)')
        print('First time: do a hard refresh (Ctrl+Shift+R) to clear old cache, then F5 is enough.')
        print('Press Ctrl+C to stop.')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
